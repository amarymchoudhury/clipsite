import dns from "node:dns/promises";
import net from "node:net";
import { execFile } from "node:child_process";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";

export type Platform = "youtube" | "vimeo" | "tiktok" | "instagram" | "facebook" | "twitter" | "twitch" | "dailymotion" | "direct" | "unknown";

export const VIDEO_EXTS = ["mp4", "mov", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "m4v", "3gp", "ts", "mts", "m2ts"];

const HOSTS: [Platform, RegExp][] = [
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["vimeo", /(^|\.)vimeo\.com$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["facebook", /(^|\.)(facebook\.com|fb\.watch)$/],
  ["twitter", /(^|\.)(twitter\.com|x\.com)$/],
  ["twitch", /(^|\.)twitch\.tv$/],
  ["dailymotion", /(^|\.)dailymotion\.com$/],
];

export function detectPlatform(u: URL): Platform {
  const host = u.hostname.toLowerCase();
  for (const [p, re] of HOSTS) if (re.test(host)) return p;
  const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTS.includes(ext)) return "direct";
  return "unknown";
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
}

/** SSRF guard: only public http(s) hosts. */
export async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "Only http(s) links are supported");
  if (u.username || u.password) throw new HttpError(400, "Links with embedded credentials are not supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, "That link's host could not be resolved");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, "That link points to a private address");
}

export function parseVideoUrl(raw: string): { url: URL; platform: Platform } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a valid link");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http(s) links are supported");
  return { url, platform: detectPlatform(url) };
}

/** fetch() that re-validates every redirect hop against the SSRF guard. */
export async function safeFetch(url: URL, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current);
      continue;
    }
    return res;
  }
  throw new HttpError(400, "Too many redirects");
}

export interface UrlMetadata {
  platform: Platform;
  title?: string;
  thumbnail?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  /** false → the platform needs yt-dlp (YTDLP_PATH) or a manual upload; reason in `note` */
  importable: boolean;
  note?: string;
}

function ytdlpJson(url: string): Promise<{ title?: string; thumbnail?: string; duration?: number }> {
  return new Promise((resolve, reject) => {
    execFile(env.YTDLP_PATH!, ["--dump-single-json", "--no-playlist", "--skip-download", url], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function fetchUrlMetadata(raw: string): Promise<UrlMetadata> {
  const { url, platform } = parseVideoUrl(raw);
  await assertPublicUrl(url);

  if (platform === "direct" || platform === "unknown") {
    const res = await safeFetch(url, { method: "HEAD" }).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    const size = Number(res?.headers.get("content-length") ?? 0) || undefined;
    const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
    const looksVideo = type.startsWith("video/") || VIDEO_EXTS.includes(ext) || type === "application/octet-stream";
    if (!res || !res.ok || !looksVideo) {
      return { platform, importable: false, note: "This link isn't a direct video file or a supported video site. Download the video and upload it instead." };
    }
    if (size && size > env.MAX_UPLOAD_MB * 1024 * 1024) {
      return { platform, importable: false, sizeBytes: size, note: `File is larger than the ${env.MAX_UPLOAD_MB} MB limit.` };
    }
    return { platform: "direct", title: decodeURIComponent(url.pathname.split("/").pop() || "Video"), sizeBytes: size, importable: true };
  }

  let meta: UrlMetadata = { platform, importable: !!env.YTDLP_PATH };
  if (env.YTDLP_PATH) {
    try {
      const j = await ytdlpJson(url.toString());
      return { platform, title: j.title, thumbnail: j.thumbnail, durationSeconds: j.duration, importable: true };
    } catch {
      /* fall through to oEmbed */
    }
  }
  const oembed =
    platform === "youtube" ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`
    : platform === "vimeo" ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.toString())}`
    : null;
  if (oembed) {
    const r = await fetch(oembed).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as { title?: string; thumbnail_url?: string };
      meta = { ...meta, title: j.title, thumbnail: j.thumbnail_url };
    }
  }
  if (!meta.importable) {
    meta.note = `Importing from ${platform} requires yt-dlp on the worker (set YTDLP_PATH) and rights to the content. Alternatively download the video yourself and upload it.`;
  }
  return meta;
}
