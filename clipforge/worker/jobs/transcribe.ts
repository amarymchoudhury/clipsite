import fs from "node:fs/promises";
import path from "node:path";
import { UnrecoverableError } from "bullmq";
import { admin } from "@/lib/supabase/admin";
import { createJob } from "@/lib/jobs";
import { getTranscriber } from "@/lib/providers";
import { ProviderNotConfiguredError } from "@/lib/providers/types";
import { attachPunctuation } from "@/lib/clips/sentences";
import type { QueuePayload, Segment, Word } from "@/lib/types";
import { ensureSource, loadProject, updateProject, workDir, type Progress } from "../db";
import { extractAudioChunks } from "../ffmpeg";

export async function transcribeJob(p: QueuePayload, progress: Progress) {
  const project = await loadProject(p);
  await updateProject(project.id, { status: "processing", stage: "transcribe" });

  let transcriber;
  try {
    transcriber = getTranscriber();
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) throw new UnrecoverableError(`${e.message} (set it on the worker, then retry).`);
    throw e;
  }

  await progress(0.02, "Extracting audio");
  const source = await ensureSource(project);
  const audioDir = path.join(workDir(project.id), "audio");
  await fs.rm(audioDir, { recursive: true, force: true });
  await fs.mkdir(audioDir, { recursive: true });
  const chunks = await extractAudioChunks(source, audioDir);
  if (!chunks.length) throw new UnrecoverableError("No audio could be extracted from this video.");

  const words: Word[] = [];
  const segments: Segment[] = [];
  const texts: string[] = [];
  let language = "unknown";
  for (let i = 0; i < chunks.length; i++) {
    await progress(0.05 + (i / chunks.length) * 0.9, `Transcribing part ${i + 1} of ${chunks.length}`);
    const t = await transcriber.transcribe(chunks[i].path);
    const off = chunks[i].offset;
    if (i === 0) language = t.language;
    texts.push(t.text.trim());
    words.push(...t.words.map((w) => ({ ...w, start: w.start + off, end: w.end + off })));
    segments.push(...t.segments.map((s) => ({ ...s, start: s.start + off, end: s.end + off })));
  }
  await fs.rm(audioDir, { recursive: true, force: true }); // temp audio no longer needed

  if (words.length < 20) {
    throw new UnrecoverableError("Almost no speech was detected in this video, so there is nothing to build clips from.");
  }

  const punctuated = attachPunctuation(words, segments);
  const db = admin();
  const { error } = await db.from("transcripts").upsert({
    project_id: project.id,
    language,
    text: texts.join(" "),
    words: punctuated,
    segments,
  });
  if (error) throw error;
  await updateProject(project.id, { language });
  await progress(1, "Transcript ready");

  await createJob({
    userId: p.userId,
    projectId: project.id,
    kind: "analyze",
    dedupeKey: `analyze:${project.id}:initial`,
    input: { mode: "initial" },
  });
}
