import fs from "node:fs/promises";
import path from "node:path";
import { UnrecoverableError } from "bullmq";
import { env } from "@/lib/env";
import { createJob } from "@/lib/jobs";
import type { QueuePayload } from "@/lib/types";
import { downloadToFile, uploadFile } from "../storage";
import { loadProject, updateProject, workDir, type Progress } from "../db";
import { importFromUrl } from "../import";
import { makeThumbnail, needsNormalize, probe, transcodeToMp4 } from "../ffmpeg";

export async function ingestJob(p: QueuePayload, progress: Progress) {
  const project = await loadProject(p);
  await updateProject(project.id, { status: "processing", stage: "ingest", error: null });
  const dir = workDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  const base = `${p.userId}/${project.id}`;

  // 1. Get the original onto local disk (and into storage, for URL imports)
  let local: string;
  let storagePath = project.storage_path;
  if (!storagePath) {
    if (project.source_type !== "url" || !project.source_url) throw new UnrecoverableError("No video has been uploaded for this project.");
    await progress(0.02, "Downloading video from link");
    const imp = await importFromUrl(project.source_url, dir, (f) => void progress(0.02 + f * 0.2, "Downloading video from link"));
    local = imp.file;
    storagePath = `${base}/source${path.extname(imp.file) || ".mp4"}`;
    await progress(0.22, "Saving original");
    await uploadFile(storagePath, local, "application/octet-stream");
    await updateProject(project.id, { storage_path: storagePath, original_filename: imp.filename });
  } else {
    await progress(0.05, "Fetching upload");
    local = path.join(dir, `original${path.extname(storagePath) || ".bin"}`);
    await downloadToFile(storagePath, local);
  }

  // 2. Validate the real container/codec rather than trusting the extension
  await progress(0.3, "Checking video");
  let info;
  try {
    info = await probe(local);
  } catch {
    throw new UnrecoverableError("This file is corrupted or is not a video that FFmpeg can read.");
  }
  if (!info.hasVideo) throw new UnrecoverableError("The file has no video stream.");
  if (!info.hasAudio) throw new UnrecoverableError("The video has no audio track, so there is no speech to analyse.");
  if (!(info.duration > 1)) throw new UnrecoverableError("Could not determine the video's duration; the file may be damaged.");
  if (info.duration > env.MAX_VIDEO_MINUTES * 60) {
    throw new UnrecoverableError(`Video is ${Math.round(info.duration / 60)} minutes long; the limit is ${env.MAX_VIDEO_MINUTES} minutes.`);
  }

  // 3. Normalise to H.264/AAC MP4 when needed (AVI, WMV, FLV, MKV, HEVC, ...) for reliable seeking
  let working = local;
  let normalizedPath: string | null = null;
  if (needsNormalize(info)) {
    const out = path.join(dir, "normalized.mp4");
    await transcodeToMp4(local, out, info.duration, (f) => void progress(0.35 + f * 0.55, "Converting to a standard format"));
    normalizedPath = `${base}/normalized.mp4`;
    await uploadFile(normalizedPath, out, "video/mp4");
    working = out;
    info = await probe(out);
  }
  // Keep a cached copy under the name later jobs expect
  const cached = path.join(dir, `source${path.extname(normalizedPath ?? storagePath) || ".mp4"}`);
  if (working !== cached) await fs.copyFile(working, cached);

  // 4. Thumbnail
  await progress(0.92, "Creating thumbnail");
  const thumb = path.join(dir, "thumb.jpg");
  await makeThumbnail(cached, thumb, Math.min(info.duration * 0.1, 30));
  const thumbPath = `${base}/thumb.jpg`;
  await uploadFile(thumbPath, thumb, "image/jpeg");

  await updateProject(project.id, {
    duration_seconds: info.duration,
    width: info.width,
    height: info.height,
    normalized_path: normalizedPath,
    thumbnail_path: thumbPath,
  });
  await progress(1, "Video ready");

  await createJob({ userId: p.userId, projectId: project.id, kind: "transcribe", dedupeKey: `transcribe:${project.id}` });
}
