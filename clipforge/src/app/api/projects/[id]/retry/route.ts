import { route, ownedProject } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Failed-job recovery: restart the pipeline from the stage that failed. */
export const POST = route(async (_req, { params }) => {
  const { user, sb, project } = await ownedProject(params.id);
  if (project.status !== "failed") throw new HttpError(409, "This project hasn't failed");
  const { data: failed } = await sb
    .from("jobs").select("kind").eq("project_id", project.id).eq("status", "failed")
    .in("kind", ["ingest", "transcribe", "analyze"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const kind = (failed?.kind ?? "ingest") as "ingest" | "transcribe" | "analyze";
  await sb.from("projects").update({ status: "queued", error: null }).eq("id", project.id);
  const { job } = await createJob({
    userId: user.id, projectId: project.id, kind,
    dedupeKey: `${kind}:${project.id}${kind === "analyze" ? ":initial" : ""}`,
    input: kind === "analyze" ? { mode: "initial" } : undefined,
  });
  return { jobId: job.id, restartedFrom: kind };
});
