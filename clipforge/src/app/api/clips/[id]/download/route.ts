import { NextResponse } from "next/server";
import { route, ownedClip } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Redirects to a short-lived signed URL for the rendered MP4. */
export const GET = route(async (_req, { params }) => {
  const { clip } = await ownedClip(params.id);
  if (clip.render_status !== "ready" || !clip.render_path) throw new HttpError(409, "This clip hasn't finished rendering");
  const name = clip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "clip";
  const url = await signedUrl(clip.render_path, { ttl: 300, download: `${name}.mp4` });
  if (!url) throw new HttpError(404, "File not found");
  return NextResponse.redirect(url);
});
