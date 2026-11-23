import { z } from "zod";
import { route, requireUser, ownedProject } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { createJob } from "@/lib/jobs";
import { PRESET_IDS } from "@/lib/presets";

export const dynamic = "force-dynamic";

const schema = z.object({
  projectId: z.string().uuid(),
  clipIds: z.array(z.string().uuid()).min(1).max(100),
  preset: z.enum(PRESET_IDS as [string, ...string[]]).default("default"),
  burnSubtitles: z.boolean().default(true),
  includeSrt: z.boolean().default(false),
  includeVtt: z.boolean().default(false),
});

/** Queues an export: clips re-encoded with a platform preset, optionally with SRT/VTT, as MP4 or ZIP. */
export const POST = route(async (req) => {
  const body = schema.parse(await req.json());
  const { user, sb, project } = await ownedProject(body.projectId);
  const { data: clips } = await sb.from("clips").select("id").eq("project_id", project.id).in("id", body.clipIds);
  const ids = (clips ?? []).map((c) => c.id as string);
  if (!ids.length) throw new HttpError(400, "None of the selected clips belong to this project");

  const { data: exp, error } = await sb
    .from("exports")
    .insert({ user_id: user.id, project_id: project.id, clip_ids: ids, preset: body.preset, burn_subtitles: body.burnSubtitles, status: "queued" })
    .select()
    .single();
  if (error) throw error;
  await createJob({
    userId: user.id, projectId: project.id, kind: "export", exportId: exp.id,
    dedupeKey: `export:${exp.id}`, input: { includeSrt: body.includeSrt, includeVtt: body.includeVtt },
  });
  return { export: exp };
});

export const GET = route(async (req) => {
  const { user, sb } = await requireUser();
  const projectId = req.nextUrl.searchParams.get("projectId");
  let q = sb.from("exports").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw error;
  return { exports: data ?? [] };
});
