import { z } from "zod";
import { route, requireUser } from "@/lib/api";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const { user, sb } = await requireUser();
  const { data, error } = await sb.from("projects").select("*, clips(count)").eq("user_id", user.id).order("created_at", { ascending: false });
  if (error) throw error;
  const projects = await Promise.all(
    (data ?? []).map(async (p) => ({ ...p, clip_count: p.clips?.[0]?.count ?? 0, thumbnail_url: await signedUrl(p.thumbnail_path) })),
  );
  return { projects };
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(300),
  size: z.number().int().positive(),
});

/** Creates a project for a device upload and returns where the browser should upload (resumable). */
export const POST = route(async (req) => {
  const { user, sb } = await requireUser();
  const body = createSchema.parse(await req.json());
  if (body.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(413, `File is larger than the ${env.MAX_UPLOAD_MB} MB limit.`);

  const { data, error } = await sb
    .from("projects")
    .insert({ user_id: user.id, title: body.title, source_type: "upload", original_filename: body.filename, status: "uploading" })
    .select()
    .single();
  if (error) throw error;

  const ext = (body.filename.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
  return {
    project: data,
    upload: { bucket: env.SUPABASE_STORAGE_BUCKET, objectName: `${user.id}/${data.id}/original.${ext}` },
  };
});
