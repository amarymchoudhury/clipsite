import { route, ownedProject, type ClipRow } from "@/lib/api";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { params }) => {
  const { sb, project } = await ownedProject(params.id);
  const { data, error } = await sb.from("clips").select("*").eq("project_id", project.id).order("score", { ascending: false });
  if (error) throw error;
  const clips = await Promise.all(
    ((data ?? []) as ClipRow[]).map(async (c) => ({
      ...c,
      video_url: c.render_status === "ready" ? await signedUrl(c.render_path) : null,
      thumbnail_url: await signedUrl(c.thumbnail_path),
    })),
  );
  return { clips };
});
