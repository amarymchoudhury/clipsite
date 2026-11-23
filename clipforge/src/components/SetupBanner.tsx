import { AlertTriangle } from "lucide-react";
import { configStatus } from "@/lib/env";

/** Honest setup-required notice. Shown whenever a service the pipeline needs isn't configured here. */
export function SetupBanner() {
  const s = configStatus();
  const items: string[] = [];
  if (!s.openai.ok) items.push(`AI analysis needs ${s.openai.missing.join(", ")} (also set it on the worker). Until then, processing will stop with a setup error.`);
  if (!s.ytdlp.ok) items.push("Importing from YouTube and other sites is disabled (set YTDLP_PATH). Direct video links and file uploads still work.");
  if (!items.length) return null;
  return (
    <div className="mb-6 rounded-2xl border border-amber-900/50 bg-amber-950/25 p-4 text-sm text-amber-100">
      <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Setup required</div>
      <ul className="list-disc space-y-1 pl-5 text-amber-200/90">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}
