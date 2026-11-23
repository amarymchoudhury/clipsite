import { z } from "zod";
import { route, ownedProject } from "@/lib/api";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";
import { objectSize } from "@/lib/storage";

export const dynamic = "force-dynamic";

const schema = z.object({ objectName: z.string().optional() });

/** Starts (or restarts, after a failure) processing. Duplicate starts are ignored while a job is active. */
export const POST = route(async (req, { params }) => {
  const { user, sb, project } = await ownedProject(params.id);
  const body = schema.parse(await req.json().catch(() => ({})));

  let storagePath = project.storage_path;
  if (project.source_type === "upload" && !storagePath) {
    const name = body.objectName ?? "";
    if (!name.startsWith(`${user.id}/${project.id}/`)) throw new HttpError(400, "Upload location is missing or invalid");
    const size = await objectSize(name);
    if (size === null) throw new HttpError(409, "The upload hasn't finished yet");
    if (size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(413, `File is larger than the ${env.MAX_UPLOAD_MB} MB limit.`);
    storagePath = name;
  }

  await sb.from("projects").update({ status: "queued", stage: "queued", progress: 0, error: null, storage_path: storagePath }).eq("id", project.id);
  const { job, created } = await createJob({ userId: user.id, projectId: project.id, kind: "ingest", dedupeKey: `ingest:${project.id}` });
  return { jobId: job.id, alreadyRunning: !created };
});
