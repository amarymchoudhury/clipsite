import fs from "node:fs/promises";
import path from "node:path";
import { UnrecoverableError } from "bullmq";
import { admin } from "@/lib/supabase/admin";
import type { ClipRow } from "@/lib/api";
import type { QueuePayload } from "@/lib/types";
import { ensureSource, loadProject, loadTranscript, workDir, type Progress } from "../db";
import { makeThumbnail } from "../ffmpeg";
import { renderClip } from "../render";
import { uploadFile } from "../storage";

/** Renders a clip with its current settings. If the clip is edited while rendering, it renders again. */
export async function renderJob(p: QueuePayload, progress: Progress) {
  if (!p.clipId) throw new UnrecoverableError("Render job has no clip");
  const db = admin();
  const project = await loadProject(p);
  const transcript = await loadTranscript(project.id);
  if (!transcript) throw new UnrecoverableError("No transcript; cannot render subtitles.");
  const source = await ensureSource(project);
  const dir = path.join(workDir(project.id), "render");
  await fs.mkdir(dir, { recursive: true });

  for (let pass = 0; pass < 3; pass++) {
    const { data, error } = await db.from("clips").select("*").eq("id", p.clipId).eq("user_id", p.userId).maybeSingle();
    if (error) throw error;
    if (!data) return; // clip deleted meanwhile
    const clip = data as ClipRow;
    await db.from("clips").update({ render_status: "rendering", render_error: null }).eq("id", clip.id);
    await progress(0.1, "Rendering clip");

    const out = path.join(dir, `${clip.id}.mp4`);
    const res = await renderClip({ workdir: dir, srcPath: source, clip, words: transcript.words, preset: "default", burn: true, outPath: out });

    await progress(0.8, "Uploading");
    const thumb = path.join(dir, `${clip.id}.jpg`);
    await makeThumbnail(out, thumb, Math.min(1.5, (Number(clip.end_seconds) - Number(clip.start_seconds)) / 2));
    const base = `${p.userId}/${project.id}/clips/${clip.id}`;
    await uploadFile(`${base}.mp4`, out, "video/mp4");
    await uploadFile(`${base}.jpg`, thumb, "image/jpeg");
    await fs.rm(out, { force: true });
    await fs.rm(thumb, { force: true });

    // Was the clip edited while we were rendering?
    const { data: after } = await db.from("clips").select("rev").eq("id", clip.id).maybeSingle();
    if (!after) return;
    const stale = after.rev !== clip.rev;
    const patch: Record<string, unknown> = {
      render_path: `${base}.mp4`,
      thumbnail_path: `${base}.jpg`,
      render_status: stale ? "rendering" : "ready",
    };
    if (res.autoFocus) patch.crop = { x: Number(res.focusX.toFixed(3)), auto: true };
    await db.from("clips").update(patch).eq("id", clip.id);
    if (!stale) break;
  }

  const { count: pending } = await db.from("clips").select("id", { count: "exact", head: true }).eq("project_id", project.id).neq("render_status", "ready");
  const { count: total } = await db.from("clips").select("id", { count: "exact", head: true }).eq("project_id", project.id);
  await db.from("projects").update({ progress: total ? Math.round(70 + 30 * (1 - (pending ?? 0) / total)) : 100 }).eq("id", project.id);
  await progress(1, "Clip ready");
}
