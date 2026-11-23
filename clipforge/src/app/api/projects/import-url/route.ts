import { z } from "zod";
import { route, requireUser } from "@/lib/api";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/errors";
import { fetchUrlMetadata } from "@/lib/url";

export const dynamic = "force-dynamic";

const schema = z.object({ url: z.string().min(4).max(2000), create: z.boolean().default(false), title: z.string().trim().max(200).optional() });

/**
 * create=false → validate the link and return metadata (title, thumbnail, duration, platform) for preview.
 * create=true  → additionally creates a project; call /api/projects/:id/start to begin processing.
 */
export const POST = route(async (req) => {
  const { user, sb } = await requireUser();
  const body = schema.parse(await req.json());
  const meta = await fetchUrlMetadata(body.url);

  if (!body.create) return { metadata: meta };

  if (!meta.importable) throw new HttpError(422, meta.note ?? "This link can't be imported.", { metadata: meta });
  if (meta.durationSeconds && meta.durationSeconds > env.MAX_VIDEO_MINUTES * 60) {
    throw new HttpError(413, `Video is ${Math.round(meta.durationSeconds / 60)} minutes long; the limit is ${env.MAX_VIDEO_MINUTES} minutes.`);
  }
  const { data, error } = await sb
    .from("projects")
    .insert({
      user_id: user.id,
      title: body.title || meta.title || "Imported video",
      source_type: "url",
      source_url: body.url.trim(),
      source_platform: meta.platform,
      duration_seconds: meta.durationSeconds ?? null,
      status: "draft",
    })
    .select()
    .single();
  if (error) throw error;
  return { project: data, metadata: meta };
});
