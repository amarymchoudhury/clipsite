import { route } from "@/lib/api";
import { configStatus, env } from "@/lib/env";
import { PRESET_IDS, EXPORT_PRESETS } from "@/lib/presets";

export const dynamic = "force-dynamic";

/** Which services are configured (never returns secret values). Drives the UI's setup-required states. */
export const GET = route(async () => ({
  services: configStatus(),
  limits: { maxUploadMb: env.MAX_UPLOAD_MB, maxVideoMinutes: env.MAX_VIDEO_MINUTES, minClipSeconds: env.MIN_CLIP_SECONDS, maxClipSeconds: env.MAX_CLIP_SECONDS },
  presets: PRESET_IDS.map((id) => ({ id, ...EXPORT_PRESETS[id] })),
}));
