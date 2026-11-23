import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { UnrecoverableError } from "bullmq";
import { env } from "@/lib/env";
import { parseVideoUrl, safeFetch, VIDEO_EXTS } from "@/lib/url";
import { run } from "./ffmpeg";

/**
 * Fetches the video behind a URL into `dir` using only permitted methods:
 *  - direct video file links via plain HTTP GET
 *  - supported sites via yt-dlp (only if configured; it does not circumvent DRM and neither do we)
 * Private/paywalled/DRM-protected media simply fails with a clear message.
 */
export async function importFromUrl(rawUrl: string, dir: string, onProgress: (f: number) => void): Promise<{ file: string; filename: string }> {
  const { url, platform } = parseVideoUrl(rawUrl);
  await fsp.mkdir(dir, { recursive: true });
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;

  if (platform === "direct" || platform === "unknown") {
    const res = await safeFetch(url, { method: "GET" });
    if (!res.ok || !res.body) throw new UnrecoverableError(`The link could not be downloaded (HTTP ${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    const ext = (url.pathname.split(".").pop() ?? "").toLowerCase();
    if (!type.startsWith("video/") && !VIDEO_EXTS.includes(ext) && type !== "application/octet-stream") {
      throw new UnrecoverableError("That link is not a video file. Upload the video instead.");
    }
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) throw new UnrecoverableError(`File is larger than the ${env.MAX_UPLOAD_MB} MB limit.`);
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "video.mp4");
    const file = path.join(dir, `import${path.extname(filename) || ".mp4"}`);
    let received = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        received += chunk.length;
        if (received > maxBytes) return cb(new UnrecoverableError(`File exceeds the ${env.MAX_UPLOAD_MB} MB limit.`));
        if (length) onProgress(received / length);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), counter, fs.createWriteStream(file));
    return { file, filename };
  }

  if (!env.YTDLP_PATH) {
    throw new UnrecoverableError(
      `Importing from ${platform} requires yt-dlp on the worker (set YTDLP_PATH). You can also download the video yourself and upload it.`,
    );
  }
  const template = path.join(dir, "import.%(ext)s");
  try {
    await run(env.YTDLP_PATH, [
      "--no-playlist", "--no-warnings",
      "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format", "mp4",
      "--max-filesize", `${env.MAX_UPLOAD_MB}M`,
      "-o", template, url.toString(),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UnrecoverableError(
      `The video could not be downloaded. It may be private, age/region-restricted, DRM-protected or not permitted for download. Upload the file instead. (${msg.split("\n").slice(-2).join(" ").slice(0, 200)})`,
    );
  }
  const found = (await fsp.readdir(dir)).find((f) => f.startsWith("import.") && !f.endsWith(".part"));
  if (!found) throw new UnrecoverableError("The download finished but no file was produced.");
  onProgress(1);
  return { file: path.join(dir, found), filename: found };
}
