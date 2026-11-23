import { UnrecoverableError } from "bullmq";
import { admin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { createJob } from "@/lib/jobs";
import { getLlm } from "@/lib/providers";
import { ProviderNotConfiguredError } from "@/lib/providers/types";
import { overlapRatio } from "@/lib/clips/postprocess";
import type { ClipCandidate, QueuePayload } from "@/lib/types";
import { getJobInput, loadProject, loadTranscript, updateProject, type Progress } from "../db";

type Mode = "initial" | "more" | "replace";

function toRow(c: ClipCandidate, userId: string, projectId: string) {
  return {
    user_id: userId,
    project_id: projectId,
    title: c.title,
    description: c.description,
    hook: c.hook,
    category: c.category,
    start_seconds: c.start,
    end_seconds: c.end,
    score: c.score,
    score_breakdown: c.breakdown,
    subtitle_theme: c.suggestedTheme,
    suggested_theme: c.suggestedTheme,
    render_status: "pending",
  };
}

export async function analyzeJob(p: QueuePayload, jobId: string, progress: Progress) {
  const db = admin();
  const project = await loadProject(p);
  const input = await getJobInput(jobId);
  const mode = (input.mode as Mode) ?? "initial";

  const transcript = await loadTranscript(project.id);
  if (!transcript) throw new UnrecoverableError("There is no transcript for this project yet.");
  if (!project.duration_seconds) throw new UnrecoverableError("Project duration is unknown.");

  let llm;
  try {
    llm = getLlm();
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) throw new UnrecoverableError(`${e.message} (set it on the worker, then retry).`);
    throw e;
  }

  await updateProject(project.id, { status: "processing", stage: "analyze" });
  await progress(0.05, "Reading the whole video for the best moments");
  const candidates = await llm.selectClips(transcript, {
    minSeconds: env.MIN_CLIP_SECONDS,
    maxSeconds: env.MAX_CLIP_SECONDS,
    durationSeconds: Number(project.duration_seconds),
  });
  await progress(0.85, "Saving clips");

  const { data: existingRows } = await db.from("clips").select("id,start_seconds,end_seconds").eq("project_id", project.id);
  const existing = (existingRows ?? []).map((r) => ({ id: r.id as string, start: Number(r.start_seconds), end: Number(r.end_seconds) }));

  const newClipIds: string[] = [];

  if (mode === "initial") {
    // idempotent on retry: start from a clean slate
    await db.from("clips").delete().eq("project_id", project.id);
    if (candidates.length) {
      const { data, error } = await db.from("clips").insert(candidates.map((c) => toRow(c, p.userId, project.id))).select("id");
      if (error) throw error;
      newClipIds.push(...(data ?? []).map((r) => r.id as string));
    }
  } else if (mode === "more") {
    const fresh = candidates.filter((c) => !existing.some((e) => overlapRatio(e, c) >= 0.35)).slice(0, 12);
    if (fresh.length) {
      const { data, error } = await db.from("clips").insert(fresh.map((c) => toRow(c, p.userId, project.id))).select("id");
      if (error) throw error;
      newClipIds.push(...(data ?? []).map((r) => r.id as string));
    }
  } else if (mode === "replace" && p.clipId) {
    const current = existing.find((e) => e.id === p.clipId);
    const others = existing.filter((e) => e.id !== p.clipId);
    const best = candidates.find((c) => !others.some((e) => overlapRatio(e, c) >= 0.35) && (!current || overlapRatio(current, c) < 0.35));
    if (best) {
      const { data: old } = await db.from("clips").select("*").eq("id", p.clipId).eq("user_id", p.userId).single();
      const history = [...((old?.history as unknown[]) ?? []), { at: new Date().toISOString(), action: "replaced", previous: { start: old?.start_seconds, end: old?.end_seconds, title: old?.title } }];
      await db.from("clips").update({
        ...toRow(best, p.userId, project.id), history, render_path: null, thumbnail_path: null, render_error: null,
        subtitle_overrides: null, crop: null, rev: (old?.rev ?? 0) + 1,
      }).eq("id", p.clipId).eq("user_id", p.userId);
      newClipIds.push(p.clipId);
    }
  }

  await updateProject(project.id, { status: "ready", stage: "done", progress: 100 });
  await progress(1, newClipIds.length ? `Found ${newClipIds.length} clip${newClipIds.length === 1 ? "" : "s"}` : "No additional clips met the quality bar");

  for (const clipId of newClipIds) {
    await createJob({ userId: p.userId, projectId: project.id, clipId, kind: "render", dedupeKey: `render:${clipId}` });
  }
}
