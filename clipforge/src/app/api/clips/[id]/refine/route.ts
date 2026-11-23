import { z } from "zod";
import { route, ownedClip, ownedProject } from "@/lib/api";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";
import { getLlm } from "@/lib/providers";
import { ProviderNotConfiguredError } from "@/lib/providers/types";
import type { Transcript } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  /** free-text request, e.g. "Make the opening more interesting" */
  instruction: z.string().trim().min(3).max(400).optional(),
  /** "replace" finds a different moment from the same video */
  mode: z.enum(["refine", "replace"]).default("refine"),
});

export const POST = route(async (req, { params }) => {
  const { user, sb, clip } = await ownedClip(params.id);
  const { project } = await ownedProject(clip.project_id);
  const body = schema.parse(await req.json());

  if (body.mode === "replace") {
    await sb.from("clips").update({ render_status: "pending" }).eq("id", clip.id).eq("user_id", user.id);
    const { job, created } = await createJob({
      userId: user.id, projectId: project.id, clipId: clip.id, kind: "analyze",
      dedupeKey: `analyze:${project.id}:replace:${clip.id}`, input: { mode: "replace" },
    });
    return { mode: "replace", jobId: job.id, alreadyRunning: !created };
  }

  if (!body.instruction) throw new HttpError(400, "Tell the AI what to change");
  const { data: tr } = await sb.from("transcripts").select("*").eq("project_id", project.id).maybeSingle();
  if (!tr) throw new HttpError(409, "No transcript available for this project");
  const transcript: Transcript = { language: tr.language, text: tr.text, words: tr.words, segments: tr.segments };

  let llm;
  try {
    llm = getLlm();
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) throw e;
    throw e;
  }
  const change = await llm.refineClip({
    transcript,
    clip: { start: Number(clip.start_seconds), end: Number(clip.end_seconds), title: clip.title, hook: clip.hook ?? "" },
    instruction: body.instruction,
    opts: { minSeconds: env.MIN_CLIP_SECONDS, maxSeconds: env.MAX_CLIP_SECONDS, durationSeconds: Number(project.duration_seconds) },
  });

  const patch: Record<string, unknown> = {};
  if (change.start !== undefined && change.end !== undefined) { patch.start_seconds = change.start; patch.end_seconds = change.end; }
  if (change.title) patch.title = change.title;
  if (change.hook !== undefined) patch.hook = change.hook;
  if (change.suggestedTheme) patch.subtitle_theme = change.suggestedTheme;
  if (!Object.keys(patch).length) return { applied: false, message: "The AI didn't find a change it could make without altering the content. Try rephrasing." };

  const historyEntry = { at: new Date().toISOString(), action: "ai-refine", instruction: body.instruction, previous: { start: clip.start_seconds, end: clip.end_seconds, title: clip.title, hook: clip.hook, theme: clip.subtitle_theme } };
  const timingChanged = "start_seconds" in patch;
  const { error } = await sb.from("clips").update({
    ...patch,
    ...(timingChanged ? { subtitle_overrides: null } : {}),
    history: [...(clip.history ?? []), historyEntry],
    rev: clip.rev + 1,
    render_status: "pending",
  }).eq("id", clip.id).eq("user_id", user.id);
  if (error) throw error;
  await createJob({ userId: user.id, projectId: project.id, clipId: clip.id, kind: "render", dedupeKey: `render:${clip.id}` });
  return { applied: true, changes: patch };
});
