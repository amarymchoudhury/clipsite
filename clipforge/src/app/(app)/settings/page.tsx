import { CheckCircle2, CircleAlert } from "lucide-react";
import { configStatus, env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { EXPORT_PRESETS } from "@/lib/presets";

export const dynamic = "force-dynamic";

const LABELS = { supabase: "Supabase (auth, database, storage)", redis: "Redis (job queue)", openai: "OpenAI (transcription + clip analysis)", ytdlp: "yt-dlp (YouTube / site import)" } as const;

export default async function SettingsPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const s = configStatus();
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="card p-6">
        <h2 className="mb-3 font-medium">Account</h2>
        <p className="text-sm text-muted">Signed in as <span className="text-white">{user?.email}</span></p>
      </section>

      <section className="card p-6">
        <h2 className="mb-1 font-medium">Services</h2>
        <p className="mb-4 text-sm text-muted">Status of the web server's configuration. The worker needs the same credentials in its own environment.</p>
        <ul className="space-y-2 text-sm">
          {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
            <li key={k} className="flex items-start gap-2">
              {s[k].ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /> : <CircleAlert className="mt-0.5 h-4 w-4 text-amber-400" />}
              <span>{LABELS[k]}{!s[k].ok && <span className="text-muted"> · missing {s[k].missing.join(", ")}</span>}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-6">
        <h2 className="mb-3 font-medium">Limits (set by the administrator via environment variables)</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Max upload</dt><dd>{env.MAX_UPLOAD_MB} MB</dd></div>
          <div><dt className="text-muted">Max video length</dt><dd>{env.MAX_VIDEO_MINUTES} min</dd></div>
          <div><dt className="text-muted">Clip length</dt><dd>{env.MIN_CLIP_SECONDS}–{env.MAX_CLIP_SECONDS} s</dd></div>
          <div><dt className="text-muted">Worker concurrency</dt><dd>{env.WORKER_CONCURRENCY}</dd></div>
        </dl>
      </section>

      <section className="card p-6">
        <h2 className="mb-3 font-medium">Export presets</h2>
        <ul className="space-y-1 text-sm text-muted">
          {Object.values(EXPORT_PRESETS).map((p) => <li key={p.label}><span className="text-white">{p.label}</span>: 1080×1920 H.264/AAC, {p.fps} fps, CRF {p.crf}, ≤{p.maxrate}</li>)}
        </ul>
      </section>
    </div>
  );
}
