import { NextResponse } from "next/server";
import { route, requireUser } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { params }) => {
  const { user, sb } = await requireUser();
  const { data } = await sb.from("exports").select("*").eq("id", params.id).eq("user_id", user.id).maybeSingle();
  if (!data) throw new HttpError(404, "Export not found");
  if (req.nextUrl.searchParams.get("download") === "1") {
    if (data.status !== "ready" || !data.storage_path) throw new HttpError(409, "Export isn't ready yet");
    const url = await signedUrl(data.storage_path, { ttl: 300, download: data.file_name ?? "export" });
    if (!url) throw new HttpError(404, "File not found");
    return NextResponse.redirect(url);
  }
  return { export: data };
});
