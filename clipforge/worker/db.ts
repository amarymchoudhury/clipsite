import fs from "node:fs/promises";
import path from "node:path";
import { admin } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { downloadToFile } from "./storage";
import type { ProjectRow } from "@/lib/api";
import type { QueuePayload, Transcript } from "@/lib/types";

export type Progress = (fraction: number, message?: string) => Promise<void>;

export async function updateJob(id: string, patch: Record<string, unknown>) {
  await admin().from("jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function updateProject(id: string, patch: Record<string, unknown>) {
  await admin().from("projects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function getJobInput(jobId: string): Promise<Record<string, unknown>> {
  const { data } = await admin().from("jobs").select("input").eq("id", jobId).maybeSingle();
  return (data?.input as Record<string, unknown>) ?? {};
}

/** Loads the project and verifies it belongs to the user that created the job. */
export async function loadProject(p: QueuePayload): Promise<ProjectRow> {
  const { data, error } = await admin().from("projects").select("*").eq("id", p.projectId).eq("user_id", p.userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Project no longer exists");
  return data as ProjectRow;
}

export async function loadTranscript(projectId: string): Promise<Transcript | null> {
  const { data } = await admin().from("transcripts").select("*").eq("project_id", projectId).maybeSingle();
  if (!data) return null;
  return { language: data.language, text: data.text, words: data.words, segments: data.segments };
}

/** Throttled progress reporter writing to the job row and (optionally) the project. */
export function makeProgress(jobId: string, projectId: string, stage: string, range: [number, number]): Progress {
  let last = 0;
  return async (fraction, message) => {
    const now = Date.now();
    if (now - last < 1500 && fraction < 1) return;
    last = now;
    const pct = Math.round(fraction * 100);
    const overall = Math.round(range[0] + (range[1] - range[0]) * fraction);
    await Promise.all([
      updateJob(jobId, { progress: pct, message: message ?? null }),
      updateProject(projectId, { stage, progress: overall }),
    ]);
  };
}

export const workDir = (projectId: string) => path.join(env.TMP_DIR, projectId);

/** Source video cached on local disk for the duration of a project's processing (cleaned up by the janitor). */
export async function ensureSource(project: ProjectRow): Promise<string> {
  const storagePath = project.normalized_path ?? project.storage_path;
  if (!storagePath) throw new Error("Project has no source video");
  const dir = workDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(storagePath) || ".mp4";
  const file = path.join(dir, `source${ext}`);
  const stat = await fs.stat(file).catch(() => null);
  if (stat && stat.size > 0) {
    const now = new Date();
    await fs.utimes(file, now, now);
    return file;
  }
  const tmp = `${file}.part`;
  await downloadToFile(storagePath, tmp);
  await fs.rename(tmp, file);
  return file;
}

/** Remove working directories untouched for `maxAgeMs`. */
export async function cleanupTmp(maxAgeMs = 6 * 3600 * 1000) {
  const entries = await fs.readdir(env.TMP_DIR).catch(() => []);
  for (const e of entries) {
    const full = path.join(env.TMP_DIR, e);
    const newest = await newestMtime(full);
    if (Date.now() - newest > maxAgeMs) await fs.rm(full, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    const st = await fs.stat(d).catch(() => null);
    if (!st) continue;
    newest = Math.max(newest, st.mtimeMs);
    if (st.isDirectory()) for (const c of await fs.readdir(d).catch(() => [])) stack.push(path.join(d, c));
  }
  return newest;
}
