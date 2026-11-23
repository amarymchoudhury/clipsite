import "./load-env"; // must stay first: loads .env before @/lib/env is evaluated
import { Worker, UnrecoverableError, type Job } from "bullmq";
import { env, configStatus } from "@/lib/env";
import { admin } from "@/lib/supabase/admin";
import { getRedis, QUEUE_NAME } from "@/lib/queue";
import type { QueuePayload } from "@/lib/types";
import { cleanupTmp, makeProgress, updateJob, updateProject } from "./db";
import { run } from "./ffmpeg";
import { ingestJob } from "./jobs/ingest";
import { transcribeJob } from "./jobs/transcribe";
import { analyzeJob } from "./jobs/analyze";
import { renderJob } from "./jobs/render";
import { exportJob } from "./jobs/export";

const STAGES: Record<string, { stage: string; range: [number, number] }> = {
  ingest: { stage: "ingest", range: [0, 15] },
  transcribe: { stage: "transcribe", range: [15, 55] },
  analyze: { stage: "analyze", range: [55, 70] },
  render: { stage: "render", range: [70, 100] },
  export: { stage: "export", range: [0, 100] },
};

async function handleJob(job: Job<QueuePayload>) {
  const p = job.data;
  await updateJob(p.jobId, { status: "running", attempts: job.attemptsMade + 1, message: "Started" });
  const s = STAGES[job.name];
  // render/export progress belongs to the job, not the project bar
  const progress = job.name === "render" || job.name === "export"
    ? async (f: number, m?: string) => { await updateJob(p.jobId, { progress: Math.round(f * 100), message: m ?? null }); }
    : makeProgress(p.jobId, p.projectId, s.stage, s.range);

  switch (job.name) {
    case "ingest": await ingestJob(p, progress); break;
    case "transcribe": await transcribeJob(p, progress); break;
    case "analyze": await analyzeJob(p, p.jobId, progress); break;
    case "render": await renderJob(p, progress); break;
    case "export": await exportJob(p, p.jobId, progress); break;
    default: throw new UnrecoverableError(`Unknown job type ${job.name}`);
  }
  await updateJob(p.jobId, { status: "succeeded", progress: 100 });
}

async function onFinalFailure(job: Job<QueuePayload>, message: string) {
  const p = job.data;
  const db = admin();
  await updateJob(p.jobId, { status: "failed", message });
  switch (job.name) {
    case "ingest":
    case "transcribe":
    case "analyze":
      await updateProject(p.projectId, { status: "failed", error: message });
      break;
    case "render":
      if (p.clipId) await db.from("clips").update({ render_status: "failed", render_error: message }).eq("id", p.clipId);
      break;
    case "export":
      if (p.exportId) await db.from("exports").update({ status: "failed", error: message }).eq("id", p.exportId);
      break;
  }
}

async function main() {
  const cfg = configStatus();
  if (!cfg.supabase.ok) throw new Error(`Supabase is not configured: ${cfg.supabase.missing.join(", ")}`);
  if (!cfg.openai.ok) console.warn(`[worker] WARNING: ${cfg.openai.missing.join(", ")} not set. Transcription/analysis jobs will fail with a setup message.`);
  for (const bin of [env.FFMPEG_PATH, env.FFPROBE_PATH]) {
    await run(bin, ["-version"]).catch(() => {
      throw new Error(`"${bin}" was not found. Install FFmpeg (see README) or set FFMPEG_PATH/FFPROBE_PATH.`);
    });
  }

  const worker = new Worker<QueuePayload>(QUEUE_NAME, handleJob, {
    connection: getRedis(),
    concurrency: env.WORKER_CONCURRENCY,
    lockDuration: 120_000,
  });

  worker.on("failed", (job, err) => {
    if (!job) return;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(`[worker] ${job.name} ${job.id} failed (attempt ${job.attemptsMade}${final ? ", final" : ", will retry"}):`, err.message);
    if (final) void onFinalFailure(job, err.message.slice(0, 500));
    else void updateJob(job.data.jobId, { status: "queued", message: `Retrying after error: ${err.message.slice(0, 200)}` });
  });
  worker.on("error", (e) => console.error("[worker] error", e));

  await cleanupTmp();
  const janitor = setInterval(() => void cleanupTmp().catch(() => undefined), 30 * 60 * 1000);

  const shutdown = async () => {
    clearInterval(janitor);
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`[worker] up. concurrency=${env.WORKER_CONCURRENCY} tmp=${env.TMP_DIR}`);
}

main().catch((e) => {
  console.error("[worker] fatal:", e.message);
  process.exit(1);
});
