import { route, ownedClip } from "@/lib/api";
import { HttpError } from "@/lib/errors";
import { resolveStyle, type SubtitleStyle } from "@/lib/subtitles/themes";
import { cuesForClip, type CueOverride } from "@/lib/subtitles/cues";
import { toSrt, toVtt } from "@/lib/subtitles/formats";
import type { Word } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET ?format=srt|vtt → subtitle file for the clip (timestamps start at 0). */
export const GET = route(async (req, { params }) => {
  const { sb, clip } = await ownedClip(params.id);
  const format = req.nextUrl.searchParams.get("format") === "vtt" ? "vtt" : "srt";
  const { data: tr } = await sb.from("transcripts").select("words").eq("project_id", clip.project_id).maybeSingle();
  if (!tr) throw new HttpError(404, "No transcript");
  const style = resolveStyle(clip.subtitle_theme, clip.subtitle_style as Partial<SubtitleStyle> | null);
  const cues = cuesForClip(tr.words as Word[], clip.subtitle_overrides as CueOverride[] | null, Number(clip.start_seconds), Number(clip.end_seconds), { ...style, emoji: false });
  const name = clip.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "clip";
  return new Response(format === "vtt" ? toVtt(cues) : toSrt(cues), {
    headers: { "Content-Type": format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.${format}"` },
  });
});
