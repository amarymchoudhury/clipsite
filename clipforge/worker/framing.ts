import { spawn } from "node:child_process";
import { env } from "@/lib/env";

const FW = 96;
const FH = 54;

/**
 * Finds the horizontal point of interest (0..1) for a clip.
 *
 * This is a motion + detail saliency heuristic, NOT face recognition: it samples low-res frames at 2 fps
 * and takes the centroid of frame-to-frame change and local contrast. For talking-head footage this
 * reliably tracks the person who is moving/gesturing; for static or ambiguous scenes it returns 0.5.
 * To use a real face/person detector, replace this function (the render pipeline only needs a number).
 */
export async function detectFocusX(src: string, start: number, duration: number): Promise<number> {
  const frames = await sampleFrames(src, start, Math.min(duration, 90));
  if (frames.length < 2) return 0.5;

  const col = new Float64Array(FW);
  for (let f = 1; f < frames.length; f++) {
    const a = frames[f - 1];
    const b = frames[f];
    for (let y = 0; y < FH; y++) {
      for (let x = 0; x < FW; x++) {
        const i = y * FW + x;
        const motion = Math.abs(b[i] - a[i]);
        const detail = x > 0 ? Math.abs(b[i] - b[i - 1]) * 0.3 : 0;
        col[x] += motion + detail;
      }
    }
  }
  // smooth, emphasise strong regions, then take the centroid
  const sm = new Float64Array(FW);
  for (let x = 0; x < FW; x++) {
    let s = 0, n = 0;
    for (let k = -4; k <= 4; k++) {
      const j = x + k;
      if (j >= 0 && j < FW) { s += col[j]; n++; }
    }
    sm[x] = (s / n) ** 2;
  }
  let total = 0, weighted = 0;
  for (let x = 0; x < FW; x++) { total += sm[x]; weighted += sm[x] * (x + 0.5); }
  if (total < 1e-6) return 0.5;
  const cx = weighted / total / FW;
  return Math.max(0.15, Math.min(0.85, cx));
}

function sampleFrames(src: string, start: number, duration: number): Promise<Uint8Array[]> {
  return new Promise((resolve) => {
    const p = spawn(env.FFMPEG_PATH, [
      "-v", "error", "-ss", String(start), "-t", String(duration), "-i", src,
      "-vf", `fps=2,scale=${FW}:${FH},format=gray`, "-an", "-f", "rawvideo", "-",
    ]);
    const chunks: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.on("error", () => resolve([]));
    p.on("close", () => {
      const all = Buffer.concat(chunks);
      const size = FW * FH;
      const frames: Uint8Array[] = [];
      for (let o = 0; o + size <= all.length; o += size) frames.push(new Uint8Array(all.subarray(o, o + size)));
      resolve(frames);
    });
  });
}
