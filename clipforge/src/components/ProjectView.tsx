"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Pencil, Play, RefreshCw, Search, Sparkles, Trash2, X, Star } from "lucide-react";
import clsx from "clsx";
import { api, fmtDuration, usePolling } from "@/lib/client";
import { StatusBadge } from "./StatusBadge";
import { ExportDialog } from "./ExportDialog";

interface Clip {
  id: string; title: string; description: string | null; hook: string | null; category: string | null;
  start_seconds: number; end_seconds: number; score: number; subtitle_theme: string; subtitles_enabled: boolean;
  render_status: "pending" | "rendering" | "ready" | "failed"; render_error: string | null;
  video_url: string | null; thumbnail_url: string | null;
}
interface Status {
  project: { status: string; stage: string | null; progress: number; error: string | null };
  pipeline: { kind: string; progress: number; message: string | null } | null;
  activeJobs: number;
  clips: { total: number; ready: number; rendering: number; pending: number; failed: number };
  recentFailures: { id: string; kind: string; message: string | null }[];
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Waiting for a worker", ingest: "Preparing video", transcribe: "Transcribing speech", analyze: "Finding the best moments", render: "Rendering clips", done: "Done",
};
const CATEGORIES = ["funny", "surprising", "educational", "inspirational", "story", "debate", "opinion", "qa", "quote", "visual"];

export function ProjectView({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"score" | "duration" | "time">("score");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [preview, setPreview] = useState<Clip | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const working = !status || ["queued", "processing", "uploading"].includes(status.project.status) || (status.activeJobs > 0);

  const refresh = useCallback(async () => {
    const s = await api<Status>(`/api/projects/${projectId}/status`);
    setStatus(s);
    const r = await api<{ clips: Clip[] }>(`/api/projects/${projectId}/clips`);
    setClips(r.clips);
  }, [projectId]);

  usePolling(refresh, 3000, working);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clips
      .filter((c) => category === "all" || c.category === category)
      .filter((c) => !q || `${c.title} ${c.description ?? ""} ${c.hook ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === "score" ? b.score - a.score : sort === "duration" ? (b.end_seconds - b.start_seconds) - (a.end_seconds - a.start_seconds) : a.start_seconds - b.start_seconds);
  }, [clips, query, category, sort]);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  async function act(key: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(key); setNotice(null);
    try { await fn(); if (okMsg) setNotice(okMsg); await refresh(); } catch (e) { setNotice(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(null); }
  }

  const topIds = useMemo(() => new Set([...clips].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(3, Math.ceil(clips.length / 4)))).map((c) => c.id)), [clips]);

  // ----- processing / failed states -----
  if (status && status.project.status === "failed") {
    return (
      <div className="card p-8">
        <p className="text-lg font-medium text-red-300">Processing failed</p>
        <p className="mt-2 text-sm text-muted">{status.project.error ?? "An unknown error occurred."}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn-primary" disabled={busy === "retry"} onClick={() => act("retry", () => api(`/api/projects/${projectId}/retry`, { method: "POST" }))}>
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">Retry resumes from the step that failed. If the error mentions a missing key or setup, fix the configuration first.</p>
      </div>
    );
  }
  if (status && ["queued", "processing", "uploading", "draft"].includes(status.project.status) && clips.length === 0) {
    const pct = Math.max(2, status.project.progress);
    return (
      <div className="card p-8">
        <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-accent-soft" /><p className="font-medium">{STAGE_LABEL[status.project.stage ?? "queued"] ?? "Working"}…</p></div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-sm text-muted">{status.pipeline?.message ?? "Queued"} · {status.project.progress}%</p>
        <p className="mt-4 text-xs text-muted">You can leave this page. Processing continues in the background and your progress is saved.</p>
        {status.project.status === "queued" && <p className="mt-2 text-xs text-muted">If this stays on “Waiting for a worker”, the background worker isn’t running (see README → Run the worker).</p>}
      </div>
    );
  }

  const failedClips = clips.filter((c) => c.render_status === "failed").length;

  return (
    <div>
      {status && status.activeJobs > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-violet-900/50 bg-violet-950/30 px-4 py-2 text-sm text-violet-200">
          <Loader2 className="h-4 w-4 animate-spin" /> {status.pipeline?.message ?? `Rendering ${status.clips.total - status.clips.ready} clip(s)`}… ({status.clips.ready}/{status.clips.total} ready)
        </div>
      )}
      {clips.length === 0 && status?.project.status === "ready" ? (
        <div className="card p-10 text-center text-muted">No moments in this video met the quality bar. Try “Generate more”, or upload a video with more speech.
          <div className="mt-4"><button className="btn-ghost" onClick={() => act("more", () => api(`/api/projects/${projectId}/more`, { method: "POST" }), "Looking for more clips…")}>Generate more</button></div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><input className="input pl-9" placeholder="Search clips" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
            <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="score">Top score</option><option value="duration">Longest</option><option value="time">Video order</option>
            </select>
            <button className="btn-ghost" onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map((c) => c.id)))}>{allSelected ? "Deselect all" : "Select all"}</button>
            <button className="btn-ghost" disabled={busy === "more" || status?.activeJobs! > 0} onClick={() => act("more", () => api(`/api/projects/${projectId}/more`, { method: "POST" }), "Looking for additional clips…")}>
              <Sparkles className="h-4 w-4" /> Generate more
            </button>
          </div>
          {notice && <p className="mb-3 rounded-xl border border-border bg-card px-4 py-2 text-sm">{notice}</p>}
          {failedClips > 0 && <p className="mb-3 text-sm text-red-300">{failedClips} clip(s) failed to render. Open them and use Re-render.</p>}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((c) => {
              const dur = c.end_seconds - c.start_seconds;
              const sel = selected.has(c.id);
              return (
                <div key={c.id} className={clsx("card flex flex-col overflow-hidden transition", sel && "border-accent ring-1 ring-accent")}>
                  <div className="relative aspect-[9/16] bg-surface">
                    {c.thumbnail_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />}
                    {c.render_status !== "ready" && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-sm">
                        {c.render_status === "failed" ? <span className="px-3 text-center text-red-300">Render failed</span> : <><Loader2 className="h-5 w-5 animate-spin" /> Rendering…</>}
                      </div>
                    )}
                    <label className="absolute left-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg bg-black/60">
                      <input type="checkbox" className="h-4 w-4 accent-[#7c5cff]" checked={sel} onChange={() => toggle(c.id)} aria-label={`Select ${c.title}`} />
                    </label>
                    <span className={clsx("absolute right-2 top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold", topIds.has(c.id) ? "bg-amber-400 text-black" : "bg-black/70")}>
                      {topIds.has(c.id) && <Star className="h-3 w-3 fill-current" />}{Math.round(c.score)}
                    </span>
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs">{fmtDuration(dur)}</span>
                    {c.render_status === "ready" && (
                      <button className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition hover:bg-black/40 hover:opacity-100" onClick={() => setPreview(c)} aria-label="Preview">
                        <Play className="h-10 w-10 fill-white" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="line-clamp-2 text-sm font-medium">{c.title}</p>
                    {c.description && <p className="line-clamp-2 text-xs text-muted">{c.description}</p>}
                    {c.hook && <p className="line-clamp-2 text-xs italic text-accent-soft">“{c.hook}”</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {c.category && <span className="rounded-full border border-border px-2 py-0.5">{c.category}</span>}
                      <span>{c.subtitles_enabled ? `Captions: ${c.subtitle_theme}` : "Captions off"}</span>
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-2">
                      <a className={clsx("btn-ghost flex-1 px-2 py-1.5 text-xs", c.render_status !== "ready" && "pointer-events-none opacity-50")} href={`/api/clips/${c.id}/download`}><Download className="h-3.5 w-3.5" /> Download</a>
                      <Link className="btn-ghost flex-1 px-2 py-1.5 text-xs" href={`/clips/${c.id}`}><Pencil className="h-3.5 w-3.5" /> Edit</Link>
                      <button className="btn-ghost px-2 py-1.5" title="Find a different moment" disabled={busy === `r${c.id}`}
                        onClick={() => act(`r${c.id}`, () => api(`/api/clips/${c.id}/refine`, { method: "POST", json: { mode: "replace" } }), "Looking for a different moment…")}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button className="btn-danger px-2 py-1.5" title="Delete clip" disabled={busy === `d${c.id}`}
                        onClick={() => { if (confirm("Delete this clip?")) act(`d${c.id}`, async () => { await api(`/api/clips/${c.id}`, { method: "DELETE" }); setSelected((s) => { const n = new Set(s); n.delete(c.id); return n; }); }); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {visible.length === 0 && <p className="py-10 text-center text-muted">No clips match your filters.</p>}
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3 shadow-2xl">
          <span className="text-sm">{selected.size} selected</span>
          <button className="btn-primary" onClick={() => setExporting(true)}><Download className="h-4 w-4" /> Export</button>
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="relative max-h-full" onClick={(e) => e.stopPropagation()}>
            <button className="absolute -right-3 -top-3 z-10 rounded-full bg-card p-2" onClick={() => setPreview(null)} aria-label="Close"><X className="h-4 w-4" /></button>
            <video src={preview.video_url ?? undefined} controls autoPlay playsInline className="max-h-[88vh] rounded-2xl bg-black" />
            <p className="mt-2 text-center text-sm">{preview.title}</p>
          </div>
        </div>
      )}

      {exporting && <ExportDialog projectId={projectId} clipIds={[...selected]} onClose={() => setExporting(false)} />}
      <StatusFooter status={status} />
    </div>
  );
}

function StatusFooter({ status }: { status: Status | null }) {
  if (!status) return null;
  return <div className="mt-8 flex items-center gap-2 text-xs text-muted">Project status: <StatusBadge status={status.project.status} /></div>;
}
