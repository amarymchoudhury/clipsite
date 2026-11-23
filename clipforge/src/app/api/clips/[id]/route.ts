import { z } from "zod";
import { route, ownedClip, ownedProject } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";
import { signedUrl } from "@/lib/storage";
import { admin, BUCKET } from "@/lib/supabase/admin";
import { SUBTITLE_THEMES } from "@/lib/types";
import { resolveStyle, type SubtitleStyle } from "@/lib/subtitles/themes";
import { cuesForClip, toAbsoluteOverrides, type CueOverride } from "@/lib/subtitles/cues";
import type { Word } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { sb, clip } = await ownedClip(params.id);
  const { project } = await ownedProject(clip.project_id);
  const { data: tr } = await sb.from("transcripts").select("words").eq("project_id", clip.project_id).maybeSingle();
  const words = ((tr?.words as Word[]) ?? []);
  const style = resolveStyle(clip.subtitle_theme, clip.subtitle_style as Partial<SubtitleStyle> | null);
  const start = Number(clip.start_seconds);
  const end = Number(clip.end_seconds);
  const cues = toAbsoluteOverrides(cuesForClip(words, clip.subtitle_overrides as CueOverride[] | null, start, end, { ...style, emoji: false }), start);
  return {
    clip: { ...clip, video_url: clip.render_status === "ready" ? await signedUrl(clip.render_path) : null, thumbnail_url: await signedUrl(clip.thumbnail_path) },
    project: { id: project.id, title: project.title, duration_seconds: project.duration_seconds },
    cues,
    sourceUrl: await signedUrl(project.normalized_path ?? project.storage_path),
  };
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(400).nullable().optional(),
  hook: z.string().trim().max(120).nullable().optional(),
  start_seconds: z.number().min(0).optional(),
  end_seconds: z.number().min(0).optional(),
  layout: z.enum(["fill", "speaker", "blur", "split"]).optional(),
  subtitle_theme: z.enum(SUBTITLE_THEMES).optional(),
  subtitles_enabled: z.boolean().optional(),
  subtitle_overrides: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(300) })).max(500).nullable().optional(),
  subtitle_style: z.record(z.unknown()).nullable().optional(),
  crop: z.object({ x: z.number().min(0).max(1), auto: z.boolean().optional() }).nullable().optional(),
  original_volume: z.number().min(0).max(2).optional(),
});

const RENDER_FIELDS = ["hook", "start_seconds", "end_seconds", "layout", "subtitle_theme", "subtitles_enabled", "subtitle_overrides", "subtitle_style", "crop", "original_volume"];

export const PATCH = route(async (req, { params }) => {
  const { user, sb, clip } = await ownedClip(params.id);
  const { project } = await ownedProject(clip.project_id);
  const body = patchSchema.parse(await req.json());

  const start = body.start_seconds ?? Number(clip.start_seconds);
  const end = body.end_seconds ?? Number(clip.end_seconds);
  if (end - start < 3) throw new HttpError(400, "A clip must be at least 3 seconds long");
  if (end - start > 180) throw new HttpError(400, "A clip can be at most 180 seconds long");
  if (project.duration_seconds && end > Number(project.duration_seconds) + 0.01) throw new HttpError(400, "Clip ends after the end of the video");

  const patch: Record<string, unknown> = { ...body };
  const needsRender = Object.keys(body).some((k) => RENDER_FIELDS.includes(k));
  if (needsRender) {
    patch.rev = clip.rev + 1;
    patch.render_status = "pending";
    if (body.crop && body.crop.auto === undefined) patch.crop = { ...body.crop, auto: false };
  }
  const { error } = await sb.from("clips").update(patch).eq("id", clip.id).eq("user_id", user.id);
  if (error) throw error;
  if (needsRender) await createJob({ userId: user.id, projectId: clip.project_id, clipId: clip.id, kind: "render", dedupeKey: `render:${clip.id}` });
  return { ok: true, rendering: needsRender };
});

export const DELETE = route(async (_req, { params }) => {
  const { user, sb, clip } = await ownedClip(params.id);
  const base = `${user.id}/${clip.project_id}/clips/${clip.id}`;
  await admin().storage.from(BUCKET).remove([`${base}.mp4`, `${base}.jpg`]);
  const { error } = await sb.from("clips").delete().eq("id", clip.id).eq("user_id", user.id);
  if (error) throw error;
  return { ok: true };
});
