import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { route, ownedProject, type ClipRow } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { signedUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "clip";

/** Streams a ZIP of already-rendered clips (?clips=id,id,...). For platform presets use /api/exports. */
export const GET = route(async (req, { params }) => {
  const { sb, project } = await ownedProject(params.id);
  const ids = (req.nextUrl.searchParams.get("clips") ?? "").split(",").filter(Boolean);
  if (!ids.length) throw new HttpError(400, "Select at least one clip");
  const { data } = await sb.from("clips").select("*").eq("project_id", project.id).in("id", ids);
  const clips = ((data ?? []) as ClipRow[]).filter((c) => c.render_status === "ready" && c.render_path);
  if (!clips.length) throw new HttpError(409, "None of the selected clips have finished rendering");

  const pass = new PassThrough();
  const zip = archiver("zip", { zlib: { level: 0 } });
  zip.on("error", (e) => pass.destroy(e));
  zip.pipe(pass);
  (async () => {
    const used = new Set<string>();
    for (const c of clips) {
      const url = await signedUrl(c.render_path);
      const res = url ? await fetch(url) : null;
      if (!res?.ok || !res.body) continue;
      let name = slug(c.title);
      for (let n = 2; used.has(name); n++) name = `${slug(c.title)}-${n}`;
      used.add(name);
      zip.append(Readable.fromWeb(res.body as never), { name: `${name}.mp4` });
    }
    await zip.finalize();
  })().catch((e) => pass.destroy(e));

  return new Response(Readable.toWeb(pass) as ReadableStream, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug(project.title)}-clips.zip"` },
  });
});
