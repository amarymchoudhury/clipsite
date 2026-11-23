import { route, ownedProject } from "@/lib/api";
import { removePrefix, signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { project } = await ownedProject(params.id);
  return { project: { ...project, thumbnail_url: await signedUrl(project.thumbnail_path) } };
});

/** Deletes the project, its clips/jobs/exports (DB cascade) and every stored file. */
export const DELETE = route(async (_req, { params }) => {
  const { user, sb, project } = await ownedProject(params.id);
  await removePrefix(`${user.id}/${project.id}`);
  const { error } = await sb.from("projects").delete().eq("id", project.id).eq("user_id", user.id);
  if (error) throw error;
  return { ok: true };
});
