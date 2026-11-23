import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { UnrecoverableError } from "bullmq";
import { admin } from "@/lib/supabase/admin";
import type { ClipRow } from "@/lib/api";
import type { QueuePayload } from "@/lib/types";
import { EXPORT_PRESETS, type PresetId } from "@/lib/presets";
import { resolveStyle, type SubtitleStyle } from "@/lib/subtitles/themes";
import { cuesForClip, type CueOverride } from "@/lib/subtitles/cues";
import { toSrt, toVtt } from "@/lib/subtitles/formats";
import { ensureSource, getJobInput, loadProject, loadTranscript, workDir, type Progress } from "../db";
import { renderClip } from "../render";
import { uploadFile } from "../storage";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "clip";

export async function exportJob(p: QueuePayload, jobId: string, progress: Progress) {
  if (!p.exportId) throw new UnrecoverableError("Export job has no export id");
  const db = admin();
  const input = await getJobInput(jobId);
  const includeSrt = input.includeSrt === true;
  const includeVtt = input.includeVtt === true;

  const { data: exp } = await db.from("exports").select("*").eq("id", p.exportId).eq("user_id", p.userId).maybeSingle();
  if (!exp) throw new UnrecoverableError("Export no longer exists");
  const preset = (exp.preset in EXPORT_PRESETS ? exp.preset : "default") as PresetId;
  await db.from("exports").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", exp.id);

  const project = await loadProject(p);
  const transcript = await loadTranscript(project.id);
  if (!transcript) throw new UnrecoverableError("No transcript available.");
  const source = await ensureSource(project);
  const { data: clipRows } = await db.from("clips").select("*").in("id", exp.clip_ids).eq("user_id", p.userId);
  const clips = (clipRows ?? []) as ClipRow[];
  if (!clips.length) throw new UnrecoverableError("None of the selected clips exist any more.");

  const dir = path.join(workDir(project.id), `export_${exp.id}`);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });

  const files: string[] = [];
  const used = new Set<string>();
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    await progress(i / clips.length, `Rendering ${i + 1} of ${clips.length}`);
    let name = slug(clip.title);
    for (let n = 2; used.has(name); n++) name = `${slug(clip.title)}-${n}`;
    used.add(name);
    await renderClip({ workdir: dir, srcPath: source, clip, words: transcript.words, preset, burn: exp.burn_subtitles, outPath: path.join(dir, `${name}.mp4`) });
    files.push(`${name}.mp4`);

    if (includeSrt || includeVtt) {
      const style = resolveStyle(clip.subtitle_theme, clip.subtitle_style as Partial<SubtitleStyle> | null);
      const cues = cuesForClip(transcript.words, clip.subtitle_overrides as CueOverride[] | null, Number(clip.start_seconds), Number(clip.end_seconds), { ...style, emoji: false });
      if (includeSrt) { await fsp.writeFile(path.join(dir, `${name}.srt`), toSrt(cues)); files.push(`${name}.srt`); }
      if (includeVtt) { await fsp.writeFile(path.join(dir, `${name}.vtt`), toVtt(cues)); files.push(`${name}.vtt`); }
    }
  }

  await progress(0.9, "Packaging");
  let outFile: string;
  let outName: string;
  let contentType: string;
  if (files.length === 1) {
    outFile = path.join(dir, files[0]);
    outName = files[0];
    contentType = "video/mp4";
  } else {
    outName = `clipforge-${preset}-${new Date().toISOString().slice(0, 10)}.zip`;
    outFile = path.join(dir, outName);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(outFile);
      const zip = archiver("zip", { zlib: { level: 0 } }); // MP4s are already compressed
      out.on("close", () => resolve());
      zip.on("error", reject);
      zip.pipe(out);
      for (const f of files) zip.file(path.join(dir, f), { name: f });
      void zip.finalize();
    });
    contentType = "application/zip";
  }

  const storagePath = `${p.userId}/${project.id}/exports/${exp.id}/${outName}`;
  await uploadFile(storagePath, outFile, contentType);
  await db.from("exports").update({ status: "ready", storage_path: storagePath, file_name: outName, error: null, updated_at: new Date().toISOString() }).eq("id", exp.id);
  await fsp.rm(dir, { recursive: true, force: true });
  await progress(1, "Export ready");
}
