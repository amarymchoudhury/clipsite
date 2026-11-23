import { spawn } from "node:child_process";
import { env } from "@/lib/env";

export function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; onStdoutLine?: (line: string) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let buf = "";
    p.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (opts.onStdoutLine) {
        buf += s;
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        parts.forEach(opts.onStdoutLine);
      } else stdout += s;
    });
    p.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 40000) stderr = stderr.slice(-20000);
    });
    p.on("error", (e) => reject(new Error(`Could not start "${bin}": ${e.message}. Is it installed and on PATH (or set via env)?`)));
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin} exited with code ${code}: ${stderr.split("\n").slice(-8).join("\n")}`)),
    );
  });
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  vcodec?: string;
  acodec?: string;
  format: string;
}

interface FfprobeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
  disposition?: { attached_pic?: number };
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env.FFPROBE_PATH, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(stdout) as { format?: { duration?: string; format_name?: string }; streams?: FfprobeStream[] };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === "audio");
  let width = v?.width ?? 0;
  let height = v?.height ?? 0;
  const rot = Math.abs(Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  const duration = Number(j.format?.duration ?? v?.duration ?? 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    fps: d ? n / d : 0,
    hasVideo: !!v,
    hasAudio: !!a,
    vcodec: v?.codec_name,
    acodec: a?.codec_name,
    format: j.format?.format_name ?? "",
  };
}

/** True when the source isn't a plain H.264/AAC MP4/MOV and should be normalised for reliable seeking. */
export function needsNormalize(p: ProbeResult): boolean {
  const container = p.format.split(",").some((f) => f === "mp4" || f === "mov");
  return !container || p.vcodec !== "h264" || (p.hasAudio && p.acodec !== "aac");
}

export async function transcodeToMp4(src: string, dst: string, durationSeconds: number, onProgress?: (p: number) => void) {
  await run(
    env.FFMPEG_PATH,
    [
      "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", dst,
    ],
    {
      onStdoutLine: (l) => {
        if (l.startsWith("out_time_ms=") && durationSeconds > 0) {
          // despite the name, the value is in microseconds
          onProgress?.(Math.min(1, Number(l.split("=")[1]) / 1e6 / durationSeconds));
        }
      },
    },
  );
}

/** 16 kHz mono MP3 in ~10 min pieces (each safely below the 25 MB transcription upload limit). */
export async function extractAudioChunks(src: string, dir: string, chunkSeconds = 600): Promise<{ path: string; offset: number }[]> {
  const fs = await import("node:fs/promises");
  await run(env.FFMPEG_PATH, [
    "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(chunkSeconds), "-reset_timestamps", "1", `${dir}/chunk_%03d.mp3`,
  ]);
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3")).sort();
  const out: { path: string; offset: number }[] = [];
  let offset = 0;
  for (const f of files) {
    const path = `${dir}/${f}`;
    out.push({ path, offset });
    offset += (await probe(path)).duration; // real duration, so timestamps don't drift
  }
  return out;
}

export async function makeThumbnail(src: string, out: string, atSeconds: number) {
  await run(env.FFMPEG_PATH, ["-y", "-ss", String(Math.max(0, atSeconds)), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", out]);
}
