import fs from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { ClipRow } from "@/lib/api";
import type { Word } from "@/lib/types";
import { EXPORT_PRESETS, type PresetId } from "@/lib/presets";
import { resolveStyle, type SubtitleStyle } from "@/lib/subtitles/themes";
import { cuesForClip, type CueOverride } from "@/lib/subtitles/cues";
import { generateAss } from "@/lib/subtitles/ass";
import { buildFilterComplex } from "@/lib/render/filters";
import { detectFocusX } from "./framing";
import { probe, run } from "./ffmpeg";

export interface RenderOptions {
  workdir: string;
  srcPath: string;
  clip: ClipRow;
  words: Word[];
  preset: PresetId;
  /** burn subtitles into the picture (the hook overlay is always burned if the clip has one) */
  burn: boolean;
  outPath: string;
}

export interface RenderResult {
  focusX: number;
  autoFocus: boolean;
  cueCount: number;
}

export async function renderClip(o: RenderOptions): Promise<RenderResult> {
  const { clip } = o;
  const start = Number(clip.start_seconds);
  const end = Number(clip.end_seconds);
  const dur = end - start;
  const preset = EXPORT_PRESETS[o.preset];

  const style = resolveStyle(clip.subtitle_theme, clip.subtitle_style as Partial<SubtitleStyle> | null);
  const cues = cuesForClip(o.words, clip.subtitle_overrides as CueOverride[] | null, start, end, style);

  const info = await probe(o.srcPath);
  if (!info.hasVideo) throw new Error("Source has no video stream");

  const manual = clip.crop && clip.crop.auto === false;
  const needsFocus = clip.layout === "fill" || clip.layout === "speaker";
  const focusX = manual ? clip.crop!.x : needsFocus ? await detectFocusX(o.srcPath, start, dur) : 0.5;

  const assName = `subs_${clip.id.replace(/[^a-z0-9]/gi, "")}_${Date.now()}.ass`;
  const assPath = path.join(o.workdir, assName);
  await fs.writeFile(assPath, generateAss({ cues, style, hook: clip.hook, durationSeconds: dur, showSubtitles: o.burn && clip.subtitles_enabled }));

  const filter = buildFilterComplex({ layout: clip.layout, srcW: info.width, srcH: info.height, cx: focusX, assFile: assName });
  const vol = Math.max(0, Math.min(2, Number(clip.original_volume ?? 1)));
  const af = `volume=${vol},afade=t=in:st=0:d=0.05,afade=t=out:st=${Math.max(0, dur - 0.2).toFixed(2)}:d=0.2`;

  const args = [
    "-y", "-ss", start.toFixed(3), "-t", dur.toFixed(3), "-i", o.srcPath,
    "-filter_complex", filter, "-map", "[v]",
    ...(info.hasAudio ? ["-map", "0:a:0", "-af", af] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-crf", String(preset.crf),
    "-maxrate", preset.maxrate, "-bufsize", preset.bufsize, "-r", String(preset.fps), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", preset.audioBitrate, "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "-sn", "-dn", o.outPath,
  ];
  try {
    await run(env.FFMPEG_PATH, args, { cwd: o.workdir });
  } finally {
    await fs.rm(assPath, { force: true });
  }
  return { focusX, autoFocus: !manual && needsFocus, cueCount: cues.length };
}
