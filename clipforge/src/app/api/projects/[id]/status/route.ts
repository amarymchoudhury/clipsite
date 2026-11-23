import { route, ownedProject } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Polled by the UI. State lives in the database, so leaving the page never loses progress. */
export const GET = route(async (_req, { params }) => {
  const { sb, project } = await ownedProject(params.id);
  const [{ data: jobs }, { data: clips }] = await Promise.all([
    sb.from("jobs").select("id,kind,status,progress,message,clip_id,updated_at").eq("project_id", project.id).order("created_at", { ascending: false }).limit(30),
    sb.from("clips").select("render_status").eq("project_id", project.id),
  ]);
  const counts = { total: clips?.length ?? 0, ready: 0, rendering: 0, pending: 0, failed: 0 };
  for (const c of clips ?? []) counts[c.render_status as "ready" | "rendering" | "pending" | "failed"]++;
  const active = (jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
  const pipeline = active.find((j) => j.kind !== "render" && j.kind !== "export") ?? null;
  return {
    project: { id: project.id, title: project.title, status: project.status, stage: project.stage, progress: project.progress, error: project.error },
    pipeline,
    activeJobs: active.length,
    clips: counts,
    recentFailures: (jobs ?? []).filter((j) => j.status === "failed").slice(0, 3),
  };
});
