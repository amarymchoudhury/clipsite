"use client";
import { useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { api, usePolling } from "@/lib/client";
import { EXPORT_PRESETS, PRESET_IDS, type PresetId } from "@/lib/presets";

interface Exp { id: string; status: string; error: string | null }

export function ExportDialog({ projectId, clipIds, onClose }: { projectId: string; clipIds: string[]; onClose: () => void }) {
  const [preset, setPreset] = useState<PresetId>("default");
  const [burn, setBurn] = useState(true);
  const [srt, setSrt] = useState(false);
  const [vtt, setVtt] = useState(false);
  const [exp, setExp] = useState<Exp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  usePolling(async () => { if (exp) setExp((await api<{ export: Exp }>(`/api/exports/${exp.id}`)).export); }, 2500, !!exp && !["ready", "failed"].includes(exp.status));

  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await api<{ export: Exp }>("/api/exports", { method: "POST", json: { projectId, clipIds, preset, burnSubtitles: burn, includeSrt: srt, includeVtt: vtt } });
      setExp(r.export);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the export"); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Export {clipIds.length} clip{clipIds.length > 1 ? "s" : ""}</h2><button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {!exp ? (
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="preset">Platform preset</label>
              <select id="preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value as PresetId)}>
                {PRESET_IDS.map((id) => <option key={id} value={id}>{EXPORT_PRESETS[id].label}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted">1080×1920 H.264/AAC. Recommended maximum length: {EXPORT_PRESETS[preset].recommendedMaxSeconds}s.</p>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={burn} onChange={(e) => setBurn(e.target.checked)} /> Burn subtitles into the video</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={srt} onChange={(e) => setSrt(e.target.checked)} /> Include .srt files</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[#7c5cff]" checked={vtt} onChange={(e) => setVtt(e.target.checked)} /> Include .vtt files</label>
            <p className="text-xs text-muted">Several clips are delivered as a single ZIP.</p>
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button className="btn-primary w-full" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start export"}</button>
          </div>
        ) : exp.status === "ready" ? (
          <div className="space-y-3 text-center"><p className="text-sm">Your export is ready.</p><a className="btn-primary w-full" href={`/api/exports/${exp.id}?download=1`}><Download className="h-4 w-4" /> Download</a></div>
        ) : exp.status === "failed" ? (
          <p className="text-sm text-red-300">Export failed: {exp.error ?? "unknown error"}</p>
        ) : (
          <div className="flex items-center gap-3 py-4 text-sm"><Loader2 className="h-5 w-5 animate-spin text-accent-soft" /> Rendering and packaging… you can close this and come back; check Library for finished clips.</div>
        )}
      </div>
    </div>
  );
}
