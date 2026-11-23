"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Pause, Play, Plus, RefreshCw, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import clsx from "clsx";
import { api, fmtDuration, usePolling } from "@/lib/client";
import { FONTS, resolveStyle, THEMES, type SubtitleStyle } from "@/lib/subtitles/themes";
import { SUBTITLE_THEMES, type ClipLayout, type SubtitleThemeId } from "@/lib/types";

interface Cue { start: number; end: number; text: string }
interface ClipData {
  id: string; project_id: string; title: string; description: string | null; hook: string | null;
  start_seconds: number; end_seconds: number; layout: ClipLayout; subtitle_theme: SubtitleThemeId; subtitles_enabled: boolean;
  subtitle_style: Partial<SubtitleStyle> | null; crop: { x: number; auto?: boolean } | null; original_volume: number;
  render_status: "pending" | "rendering" | "ready" | "failed"; render_error: string | null; video_url: string | null; suggested_theme: string | null;
}
interface Payload { clip: ClipData; project: { id: string; title: string; duration_seconds: number }; cues: Cue[]; sourceUrl: string | null }

const AI_PROMPTS = [
  "Make the opening more interesting",
  "Find a better starting point",
  "Make this clip shorter",
  "Make the clip easier to understand without context",
  "Suggest a stronger title",
  "Use a different subtitle style",
  "Make the subtitles more engaging",
];
const LAYOUTS: { id: ClipLayout; label: string }[] = [
  { id: "fill", label: "Full-screen crop" }, { id: "speaker", label: "Speaker focus" }, { id: "blur", label: "Blurred background" }, { id: "split", label: "Split screen" },
];

export function ClipEditor({ clipId }: { clipId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // editable state
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [layout, setLayout] = useState<ClipLayout>("fill");
  const [cropX, setCropX] = useState(0.5);
  const [theme, setTheme] = useState<SubtitleThemeId>("bold");
  const [subsOn, setSubsOn] = useState(true);
  const [styleOv, setStyleOv] = useState<Partial<SubtitleStyle>>({});
  const [cues, setCues] = useState<Cue[]>([]);
  const [cuesEdited, setCuesEdited] = useState(false);
  const [volume, setVolume] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const hydrate = useCallback((p: Payload) => {
    const c = p.clip;
    setData(p);
    setTitle(c.title); setHook(c.hook ?? ""); setStart(Number(c.start_seconds)); setEnd(Number(c.end_seconds));
    setLayout(c.layout); setCropX(c.crop?.x ?? 0.5); setTheme(c.subtitle_theme); setSubsOn(c.subtitles_enabled);
    setStyleOv(c.subtitle_style ?? {}); setCues(p.cues); setCuesEdited(false); setVolume(Number(c.original_volume)); setDirty(false);
  }, []);

  const load = useCallback(async () => { hydrate(await api<Payload>(`/api/clips/${clipId}`)); }, [clipId, hydrate]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  const rendering = data?.clip.render_status === "pending" || data?.clip.render_status === "rendering";
  // while a render is in flight, poll only the status, then reload everything once it finishes
  usePolling(async () => { const p = await api<Payload>(`/api/clips/${clipId}`); if (p.clip.render_status === "ready" || p.clip.render_status === "failed") hydrate(p); }, 3000, !!rendering && !dirty);

  const style = useMemo(() => resolveStyle(theme, styleOv), [theme, styleOv]);
  const mark = <K,>(set: (v: K) => void) => (v: K) => { set(v); setDirty(true); };

  // ---- live preview from the source video ----
  const src = data?.sourceUrl ?? null;
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    const seek = () => { v.currentTime = start; setTime(start); };
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
  }, [src, start]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = Math.min(1, volume); }, [volume]);

  function onTimeUpdate() {
    const v = videoRef.current!;
    setTime(v.currentTime);
    if (v.currentTime >= end) { v.pause(); v.currentTime = start; setPlaying(false); }
  }
  function toggle() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start; void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }
  function scrub(t: number) { if (videoRef.current) { videoRef.current.currentTime = t; setTime(t); } }

  const activeCue = cues.find((c) => time >= c.start && time < c.end);
  const showHook = hook.trim() && time - start < 3.5;
  const duration = end - start;
  const total = data?.project.duration_seconds ?? 0;

  const previewStyle: React.CSSProperties = layout === "blur" || layout === "split" ? {} : { objectFit: "cover", objectPosition: `${cropX * 100}% ${layout === "speaker" ? 30 : 50}%`, transform: layout === "speaker" ? "scale(1.3)" : undefined, transformOrigin: `${cropX * 100}% 30%` };

  // ---- cue editing ----
  const updateCue = (i: number, patch: Partial<Cue>) => { setCues((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c))); setCuesEdited(true); setDirty(true); };
  const removeCue = (i: number) => { setCues((cs) => cs.filter((_, k) => k !== i)); setCuesEdited(true); setDirty(true); };
  const addCue = () => { const t = Math.min(Math.max(time, start), end - 0.5); setCues((cs) => [...cs, { start: t, end: Math.min(end, t + 1.5), text: "New caption" }].sort((a, b) => a.start - b.start)); setCuesEdited(true); setDirty(true); };

  async function save(): Promise<boolean> {
    if (end - start < 3) { setNotice("A clip must be at least 3 seconds long."); return false; }
    setSaving(true); setNotice(null);
    try {
      const body: Record<string, unknown> = {
        title, hook: hook.trim() || null, start_seconds: start, end_seconds: end, layout, subtitle_theme: theme, subtitles_enabled: subsOn,
        subtitle_style: Object.keys(styleOv).length ? styleOv : null, original_volume: volume,
        crop: layout === "fill" || layout === "speaker" ? { x: cropX } : null,
      };
      if (cuesEdited) body.subtitle_overrides = cues.filter((c) => c.text.trim() && c.end > c.start);
      await api(`/api/clips/${clipId}`, { method: "PATCH", json: body });
      setNotice("Saved. Re-rendering the clip…");
      await load();
      return true;
    } catch (e) { setNotice(e instanceof Error ? e.message : "Save failed"); return false; } finally { setSaving(false); }
  }

  async function askAi(instruction: string, mode: "refine" | "replace" = "refine") {
    if (dirty && !(await save())) return;
    setAiBusy(true); setNotice(null);
    try {
      const r = await api<{ applied?: boolean; message?: string; mode?: string }>(`/api/clips/${clipId}/refine`, { method: "POST", json: mode === "replace" ? { mode } : { instruction, mode } });
      setNotice(r.mode === "replace" ? "Looking for a different moment… the clip will update when ready." : r.applied ? "AI changes applied. Re-rendering…" : r.message ?? "No change made.");
      setAiText("");
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "AI request failed"); } finally { setAiBusy(false); }
  }

  if (error) return <div className="card p-8 text-red-300">{error}</div>;
  if (!data) return <div className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const num = (v: string, fallback: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);
  const dlName = `/api/clips/${clipId}`;

  return (
    <div>
      <Link href={`/projects/${data.project.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-white"><ArrowLeft className="h-4 w-4" /> {data.project.title}</Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Edit clip</h1>
        <div className="flex flex-wrap items-center gap-2">
          {rendering && <span className="flex items-center gap-2 text-sm text-violet-300"><Loader2 className="h-4 w-4 animate-spin" /> Rendering</span>}
          {data.clip.render_status === "failed" && <span className="text-sm text-red-300">Render failed: {data.clip.render_error}</span>}
          <button className="btn-primary" disabled={!dirty || saving} onClick={() => void save()}><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save & re-render"}</button>
        </div>
      </div>
      {notice && <p className="mb-4 rounded-xl border border-border bg-card px-4 py-2 text-sm">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* ---------- preview ---------- */}
        <div>
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[360px] overflow-hidden rounded-2xl border border-border bg-black">
            {src ? (
              <>
                {layout === "blur" && <video src={src} muted playsInline className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl" ref={(el) => { if (el && videoRef.current) el.currentTime = videoRef.current.currentTime; }} />}
                <video ref={videoRef} src={src} playsInline preload="auto" onTimeUpdate={onTimeUpdate} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)}
                  className={clsx("absolute", layout === "blur" ? "left-0 top-1/2 w-full -translate-y-1/2" : layout === "split" ? "left-0 top-0 h-full w-full object-cover" : "inset-0 h-full w-full")} style={previewStyle} />
              </>
            ) : <div className="flex h-full items-center justify-center text-sm text-muted">Source preview unavailable</div>}
            {showHook && <div className="absolute inset-x-6 top-[11%] rounded-lg bg-black/60 px-3 py-2 text-center text-sm font-bold">{hook}</div>}
            {subsOn && activeCue && (
              <div className={clsx("absolute inset-x-4 text-center leading-tight", style.position === "top" ? "top-[22%]" : style.position === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-[27%]")}
                style={{ fontFamily: `"${style.font}", sans-serif`, fontWeight: style.bold ? 800 : 500, fontSize: `${style.size * (360 / 1080)}px`, color: style.color, textTransform: style.uppercase ? "uppercase" : "none",
                  WebkitTextStroke: `${Math.max(1, style.outlineWidth * (360 / 1080) * 0.6)}px ${style.outline}`, paintOrder: "stroke fill", background: style.background ? `${style.background}${Math.round(style.backgroundOpacity * 255).toString(16).padStart(2, "0")}` : undefined, lineHeight: 1.15 + style.lineSpacing / 100 }}>
                <PreviewCaption text={activeCue.text} cue={activeCue} time={time} style={style} />
              </div>
            )}
          </div>
          <div className="mx-auto mt-3 max-w-[360px]">
            <div className="flex items-center gap-3">
              <button className="btn-ghost px-3" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
              <input type="range" className="w-full accent-[#7c5cff]" min={start} max={end} step={0.05} value={Math.min(Math.max(time, start), end)} onChange={(e) => scrub(Number(e.target.value))} aria-label="Timeline" />
            </div>
            <p className="mt-1 text-center text-xs text-muted">{fmtDuration(Math.max(0, time - start))} / {fmtDuration(duration)}</p>
            <p className="mt-2 text-center text-xs text-muted">Preview is a fast approximation using the source video. Exact framing and caption styling are applied in the final render.</p>
          </div>
          <div className="mx-auto mt-4 flex max-w-[360px] flex-wrap gap-2">
            <a className={clsx("btn-ghost flex-1 text-xs", data.clip.render_status !== "ready" && "pointer-events-none opacity-50")} href={`${dlName}/download`}><Download className="h-3.5 w-3.5" /> MP4</a>
            <a className="btn-ghost flex-1 text-xs" href={`${dlName}/subtitles?format=srt`}>SRT</a>
            <a className="btn-ghost flex-1 text-xs" href={`${dlName}/subtitles?format=vtt`}>VTT</a>
            <button className="btn-ghost flex-1 text-xs" disabled={rendering} onClick={async () => { await api(`${dlName}/render`, { method: "POST" }); await load(); }}><RefreshCw className="h-3.5 w-3.5" /> Re-render</button>
          </div>
        </div>

        {/* ---------- controls ---------- */}
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-medium"><Wand2 className="h-4 w-4 text-accent-soft" /> AI improvements</h2>
            <div className="mb-3 flex flex-wrap gap-2">
              {AI_PROMPTS.map((p) => <button key={p} className="rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-white disabled:opacity-50" disabled={aiBusy || rendering} onClick={() => askAi(p)}>{p}</button>)}
              <button className="rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-white disabled:opacity-50" disabled={aiBusy || rendering} onClick={() => askAi("", "replace")}>Find a different moment</button>
            </div>
            <div className="flex gap-2">
              <input className="input" placeholder="Or describe what to change…" value={aiText} onChange={(e) => setAiText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aiText.trim().length >= 3 && askAi(aiText)} />
              <button className="btn-primary shrink-0" disabled={aiBusy || rendering || aiText.trim().length < 3} onClick={() => askAi(aiText)}>{aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Apply</button>
            </div>
            <p className="mt-2 text-xs text-muted">The AI only re-selects, re-titles or re-styles using what is actually said. It never rewrites dialogue. Unsaved edits are saved first.</p>
          </section>

          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" className="input" value={title} maxLength={120} onChange={(e) => mark(setTitle)(e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="hook">Opening hook (text overlay, first 3 seconds)</label><input id="hook" className="input" value={hook} maxLength={120} placeholder="Leave empty for no overlay" onChange={(e) => mark(setHook)(e.target.value)} /></div>
            <div>
              <label className="label" htmlFor="start">Start (s) · video is {fmtDuration(total)}</label>
              <input id="start" className="input" type="number" step="0.1" min={0} max={Math.max(0, end - 3)} value={Number(start.toFixed(2))} onChange={(e) => mark(setStart)(Math.max(0, Math.min(num(e.target.value, start), end - 3)))} />
            </div>
            <div>
              <label className="label" htmlFor="end">End (s) · length {duration.toFixed(1)}s</label>
              <input id="end" className="input" type="number" step="0.1" min={start + 3} max={total || undefined} value={Number(end.toFixed(2))} onChange={(e) => mark(setEnd)(Math.min(total || Infinity, Math.max(num(e.target.value, end), start + 3)))} />
            </div>
            <div className="sm:col-span-2 flex gap-2 text-xs">
              {[-1, -0.5, 0.5, 1].map((d) => <button key={`s${d}`} className="btn-ghost px-2 py-1" onClick={() => mark(setStart)(Math.max(0, Math.min(start + d, end - 3)))}>Start {d > 0 ? "+" : ""}{d}s</button>)}
              {[-1, 1].map((d) => <button key={`e${d}`} className="btn-ghost px-2 py-1" onClick={() => mark(setEnd)(Math.min(total || Infinity, Math.max(end + d, start + 3)))}>End {d > 0 ? "+" : ""}{d}s</button>)}
            </div>
            {end - start > 60 && <p className="text-xs text-amber-300 sm:col-span-2">Over 60 seconds: YouTube Shorts requires 60s or less.</p>}
          </section>

          <section className="card grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="layout">Layout / aspect handling</label>
              <select id="layout" className="input" value={layout} onChange={(e) => mark(setLayout)(e.target.value as ClipLayout)}>{LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
              <p className="mt-1 text-xs text-muted">Output is always 9:16, 1080×1920. Split screen expects a side-by-side source.</p>
            </div>
            <div>
              <label className="label" htmlFor="crop">Crop position (left ↔ right)</label>
              <input id="crop" type="range" min={0} max={1} step={0.01} className="w-full accent-[#7c5cff]" disabled={layout === "blur" || layout === "split"} value={cropX} onChange={(e) => mark(setCropX)(Number(e.target.value))} />
              <p className="text-xs text-muted">{data.clip.crop?.auto && cropX === data.clip.crop.x ? "Auto-detected focus. Adjust to override." : "Manual"}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="vol">Original audio volume ({Math.round(volume * 100)}%)</label>
              <input id="vol" type="range" min={0} max={2} step={0.05} className="w-full accent-[#7c5cff]" value={volume} onChange={(e) => mark(setVolume)(Number(e.target.value))} />
              <p className="text-xs text-muted">Background music tracks aren’t added by ClipForge, so only the original audio is adjustable.</p>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Subtitles</h2>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={subsOn} onChange={(e) => mark(setSubsOn)(e.target.checked)} /> Show subtitles</label></div>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SUBTITLE_THEMES.map((t) => (
                <button key={t} title={THEMES[t].description} onClick={() => { setTheme(t); setStyleOv({}); setDirty(true); }}
                  className={clsx("rounded-xl border px-3 py-2 text-left text-xs transition", theme === t ? "border-accent bg-accent/10" : "border-border hover:border-accent/60")}>
                  <span className="block font-medium">{THEMES[t].label}</span>{data.clip.suggested_theme === t && <span className="text-[10px] text-accent-soft">AI recommended</span>}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label className="label">Font</label><select className="input" value={style.font} onChange={(e) => { setStyleOv({ ...styleOv, font: e.target.value }); setDirty(true); }}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></div>
              <div><label className="label">Size ({style.size})</label><input type="range" min={36} max={120} className="w-full accent-[#7c5cff]" value={style.size} onChange={(e) => { setStyleOv({ ...styleOv, size: Number(e.target.value) }); setDirty(true); }} /></div>
              <div><label className="label">Position</label><select className="input" value={style.position} onChange={(e) => { setStyleOv({ ...styleOv, position: e.target.value as SubtitleStyle["position"] }); setDirty(true); }}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></div>
              <div><label className="label">Text colour</label><input type="color" className="h-9 w-full rounded-lg border border-border bg-surface" value={style.color} onChange={(e) => { setStyleOv({ ...styleOv, color: e.target.value.toUpperCase() }); setDirty(true); }} /></div>
              <div><label className="label">Highlight colour</label><input type="color" className="h-9 w-full rounded-lg border border-border bg-surface" value={style.highlight} onChange={(e) => { setStyleOv({ ...styleOv, highlight: e.target.value.toUpperCase() }); setDirty(true); }} /></div>
              <div><label className="label">Outline colour</label><input type="color" className="h-9 w-full rounded-lg border border-border bg-surface" value={style.outline} onChange={(e) => { setStyleOv({ ...styleOv, outline: e.target.value.toUpperCase() }); setDirty(true); }} /></div>
              <div><label className="label">Outline ({style.outlineWidth})</label><input type="range" min={0} max={16} className="w-full accent-[#7c5cff]" value={style.outlineWidth} onChange={(e) => { setStyleOv({ ...styleOv, outlineWidth: Number(e.target.value) }); setDirty(true); }} /></div>
              <div><label className="label">Line spacing ({style.lineSpacing})</label><input type="range" min={0} max={30} className="w-full accent-[#7c5cff]" value={style.lineSpacing} onChange={(e) => { setStyleOv({ ...styleOv, lineSpacing: Number(e.target.value) }); setDirty(true); }} /></div>
              <div><label className="label">Words per caption ({style.maxWordsPerCue})</label><input type="range" min={1} max={8} className="w-full accent-[#7c5cff]" disabled={cuesEdited} value={style.maxWordsPerCue} onChange={(e) => { setStyleOv({ ...styleOv, maxWordsPerCue: Number(e.target.value) }); setDirty(true); }} /></div>
              <div><label className="label">Animation</label><select className="input" value={style.animation} onChange={(e) => { setStyleOv({ ...styleOv, animation: e.target.value as SubtitleStyle["animation"] }); setDirty(true); }}><option value="none">None</option><option value="pop">Pop</option><option value="karaoke">Word-by-word highlight</option></select></div>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={style.background !== null} onChange={(e) => { setStyleOv({ ...styleOv, background: e.target.checked ? "#000000" : null, backgroundOpacity: e.target.checked ? 0.55 : 0 }); setDirty(true); }} /> Background box</label>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={style.emoji} onChange={(e) => { setStyleOv({ ...styleOv, emoji: e.target.checked }); setDirty(true); }} /> Emoji</label>
              <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={style.uppercase} onChange={(e) => { setStyleOv({ ...styleOv, uppercase: e.target.checked }); setDirty(true); }} /> UPPERCASE</label>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-medium">Caption text &amp; timing</h2><button className="btn-ghost px-3 py-1.5 text-xs" onClick={addCue}><Plus className="h-3.5 w-3.5" /> Add at playhead</button></div>
            <p className="mb-3 text-xs text-muted">Times are on the source video’s timeline. Editing any caption freezes the caption grouping; changing the clip’s start or end afterwards trims captions to the new range.</p>
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {cues.length === 0 && <p className="text-sm text-muted">No speech was detected in this range.</p>}
              {cues.map((c, i) => (
                <div key={i} className={clsx("grid grid-cols-[84px_84px_1fr_auto] items-center gap-2 rounded-xl border p-2", activeCue === c ? "border-accent" : "border-border")}>
                  <input className="input px-2 py-1 text-xs" type="number" step="0.05" aria-label="Caption start" value={Number(c.start.toFixed(2))} onChange={(e) => updateCue(i, { start: num(e.target.value, c.start) })} onFocus={() => scrub(c.start)} />
                  <input className="input px-2 py-1 text-xs" type="number" step="0.05" aria-label="Caption end" value={Number(c.end.toFixed(2))} onChange={(e) => updateCue(i, { end: num(e.target.value, c.end) })} />
                  <input className="input py-1 text-sm" aria-label="Caption text" value={c.text} onChange={(e) => updateCue(i, { text: e.target.value })} />
                  <button className="text-muted hover:text-red-300" onClick={() => removeCue(i)} aria-label="Delete caption"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PreviewCaption({ text, cue, time, style }: { text: string; cue: Cue; time: number; style: SubtitleStyle }) {
  const tokens = text.split(/\s+/);
  const t = style.uppercase ? (s: string) => s.toUpperCase() : (s: string) => s;
  if (style.animation === "karaoke") {
    const active = Math.min(tokens.length - 1, Math.floor(((time - cue.start) / Math.max(0.01, cue.end - cue.start)) * tokens.length));
    return <>{tokens.map((w, i) => <span key={i} style={{ color: i <= active ? style.highlight : style.color }}>{t(w)} </span>)}</>;
  }
  return <>{t(text)}</>;
}
