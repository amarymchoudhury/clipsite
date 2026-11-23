import { route, ownedProject } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Re-analyses the transcript for additional non-overlapping clips ("generate more"). */
export const POST = route(async (_req, { params }) => {
  const { user, project } = await ownedProject(params.id);
  if (project.status !== "ready") throw new HttpError(409, "The project isn't ready yet");
  const { job, created } = await createJob({
    userId: user.id, projectId: project.id, kind: "analyze", dedupeKey: `analyze:${project.id}:more`, input: { mode: "more" },
  });
  return { jobId: job.id, alreadyRunning: !created };
});
