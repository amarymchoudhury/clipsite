import { route, ownedClip } from "@/lib/api";
import { createJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** (Re)render with current settings, e.g. after a failure. */
export const POST = route(async (_req, { params }) => {
  const { user, sb, clip } = await ownedClip(params.id);
  await sb.from("clips").update({ render_status: "pending", render_error: null, rev: clip.rev + 1 }).eq("id", clip.id).eq("user_id", user.id);
  const { job, created } = await createJob({ userId: user.id, projectId: clip.project_id, clipId: clip.id, kind: "render", dedupeKey: `render:${clip.id}` });
  return { jobId: job.id, alreadyRunning: !created };
});
