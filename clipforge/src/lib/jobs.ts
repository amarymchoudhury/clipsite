import { admin } from "@/lib/supabase/admin";
import { enqueue } from "@/lib/queue";
import { SetupRequiredError } from "@/lib/errors";
import type { JobKind } from "@/lib/types";

export interface CreateJobArgs {
  userId: string;
  projectId: string;
  kind: JobKind;
  clipId?: string;
  exportId?: string;
  /** Same key while a job is queued/running → no duplicate job (enforced by a partial unique index). */
  dedupeKey?: string;
  /** Job-specific options, e.g. { mode: "more" } for analyze or { preset } for export. */
  input?: Record<string, unknown>;
}

export async function createJob(a: CreateJobArgs) {
  const db = admin();
  const { data, error } = await db
    .from("jobs")
    .insert({
      user_id: a.userId,
      project_id: a.projectId,
      clip_id: a.clipId ?? null,
      kind: a.kind,
      dedupe_key: a.dedupeKey ?? null,
      input: a.input ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505" && a.dedupeKey) {
      const { data: existing } = await db
        .from("jobs")
        .select("*")
        .eq("dedupe_key", a.dedupeKey)
        .in("status", ["queued", "running"])
        .maybeSingle();
      if (existing) return { job: existing, created: false };
    }
    throw error;
  }

  try {
    await enqueue(a.kind, {
      jobId: data.id,
      userId: a.userId,
      projectId: a.projectId,
      clipId: a.clipId,
      exportId: a.exportId,
    });
  } catch (e) {
    await db.from("jobs").update({ status: "failed", message: "Queue unavailable" }).eq("id", data.id);
    throw new SetupRequiredError("Redis queue", ["REDIS_URL (is Redis reachable?)"]);
  }
  return { job: data, created: true };
}
