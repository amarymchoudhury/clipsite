import type { ClipLayout } from "@/lib/types";
import { VIDEO_H, VIDEO_W } from "@/lib/subtitles/ass";

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Scale to cover WxH (optionally zoomed), then crop around horizontal centre `cx` (0..1). */
export function coverCrop(srcW: number, srcH: number, W: number, H: number, cx: number, zoom = 1, yBias = 0.5): string {
  const scale = Math.max(W / srcW, H / srcH) * zoom;
  const w = even(Math.ceil(srcW * scale));
  const h = even(Math.ceil(srcH * scale));
  const x = Math.round(Math.max(0, Math.min(w - W, w * cx - W / 2)));
  const y = Math.round(Math.max(0, Math.min(h - H, (h - H) * yBias)));
  return `scale=${w}:${h},crop=${W}:${H}:${x}:${y}`;
}

export interface FilterArgs {
  layout: ClipLayout;
  srcW: number;
  srcH: number;
  /** horizontal focus 0..1 */
  cx: number;
  /** filename (relative to ffmpeg cwd) of the ASS file, or null for none */
  assFile: string | null;
}

/** Builds a -filter_complex graph from [0:v] to [v] producing 1080x1920 yuv420p. */
export function buildFilterComplex(a: FilterArgs): string {
  const W = VIDEO_W;
  const H = VIDEO_H;
  let graph: string;
  switch (a.layout) {
    case "blur":
      graph =
        `[0:v]split[a][b];` +
        `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:6,eq=brightness=-0.08[bg];` +
        `[b]scale=${W}:-2:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2`;
      break;
    case "split":
      // Side-by-side source (two people): left half on top, right half below.
      graph =
        `[0:v]split[l][r];` +
        `[l]crop=iw/2:ih:0:0,scale=${W}:${H / 2}:force_original_aspect_ratio=increase,crop=${W}:${H / 2}[t];` +
        `[r]crop=iw/2:ih:iw/2:0,scale=${W}:${H / 2}:force_original_aspect_ratio=increase,crop=${W}:${H / 2}[u];` +
        `[t][u]vstack`;
      break;
    case "speaker":
      graph = `[0:v]${coverCrop(a.srcW, a.srcH, W, H, a.cx, 1.3, 0.3)}`;
      break;
    case "fill":
    default:
      graph = `[0:v]${coverCrop(a.srcW, a.srcH, W, H, a.cx)}`;
  }
  graph += `,setsar=1,format=yuv420p`;
  if (a.assFile) graph += `,ass=${a.assFile}`;
  return graph + "[v]";
}
