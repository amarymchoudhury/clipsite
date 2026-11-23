import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("videos"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TRANSCRIPTION_PROVIDER: z.string().default("openai"),
  LLM_PROVIDER: z.string().default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIBE_MODEL: z.string().default("whisper-1"),
  OPENAI_LLM_MODEL: z.string().default("gpt-4o"),
  MAX_UPLOAD_MB: z.coerce.number().default(4096),
  MAX_VIDEO_MINUTES: z.coerce.number().default(180),
  MIN_CLIP_SECONDS: z.coerce.number().default(10),
  MAX_CLIP_SECONDS: z.coerce.number().default(60),
  WORKER_CONCURRENCY: z.coerce.number().default(2),
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  TMP_DIR: z.string().default("/tmp/clipforge"),
  YTDLP_PATH: z.string().optional(),
});

// Blank values in .env (e.g. `OPENAI_API_KEY=`) mean "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "" && v !== undefined));
export const env = schema.parse(raw);

export type ServiceKey = "supabase" | "redis" | "openai" | "ytdlp";

/** Honest setup state: which required services are configured. */
export function configStatus(): Record<ServiceKey, { ok: boolean; missing: string[] }> {
  const missing = (keys: (keyof typeof env)[]) => keys.filter((k) => !env[k]).map(String);
  const sb = missing(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  const ai = missing(["OPENAI_API_KEY"]);
  return {
    supabase: { ok: sb.length === 0, missing: sb },
    redis: { ok: !!env.REDIS_URL, missing: env.REDIS_URL ? [] : ["REDIS_URL"] },
    openai: { ok: ai.length === 0, missing: ai },
    ytdlp: { ok: !!env.YTDLP_PATH, missing: env.YTDLP_PATH ? [] : ["YTDLP_PATH"] },
  };
}
