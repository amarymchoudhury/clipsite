"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Link2, UploadCloud, X, Loader2 } from "lucide-react";
import clsx from "clsx";
import { api, ApiError, fmtBytes, fmtDuration } from "@/lib/client";
import { supabaseBrowser } from "@/lib/supabase/client";

interface Meta { platform: string; title?: string; thumbnail?: string; durationSeconds?: number; sizeBytes?: number; importable: boolean; note?: string }
interface Limits { maxUploadMb: number; maxVideoMinutes: number }

export function UploadPanel() {
  const router = useRouter();
  const [tab, setTab] = useState<"url" | "file">("file");
  const [limits, setLimits] = useState<Limits>({ maxUploadMb: 4096, maxVideoMinutes: 180 });
  const [error, setError] = useState<string | null>(null);

  // URL import
  const [url, setUrl] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);

  // File upload
  const [file, setFile] = useState<File | null>(null);
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const projectRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ limits: Limits }>("/api/status").then((s) => setLimits(s.limits)).catch(() => undefined);
  }, []);

  function pick(f: File | null | undefined) {
    setError(null);
    setFileDuration(null);
    if (!f) return;
    if (f.size === 0) return setError("That file is empty.");
    if (f.size > limits.maxUploadMb * 1024 * 1024) return setError(`That file is ${fmtBytes(f.size)}; the limit is ${limits.maxUploadMb} MB.`);
    setFile(f);
    // Best-effort duration (not every format plays in the browser; the server validates the real file).
    const v = document.createElement("video");
    const obj = URL.createObjectURL(f);
    v.preload = "metadata";
    v.onloadedmetadata = () => { if (isFinite(v.duration)) setFileDuration(v.duration); URL.revokeObjectURL(obj); };
    v.onerror = () => URL.revokeObjectURL(obj);
    v.src = obj;
  }

  async function startUpload() {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const { project, upload } = await api<{ project: { id: string }; upload: { bucket: string; objectName: string } }>("/api/projects", {
        method: "POST",
        json: { title: file.name.replace(/\.[^.]+$/, "") || "Untitled video", filename: file.name, size: file.size },
      });
      projectRef.current = project.id;
      const { data: { session } } = await supabaseBrowser().auth.getSession();
      if (!session) throw new Error("You've been signed out. Please sign in again.");

      const up = new tus.Upload(file, {
        endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, "x-upsert": "true" },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024, // Supabase requires 6 MB chunks
        metadata: { bucketName: upload.bucket, objectName: upload.objectName, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
        onProgress: (sent, total) => setProgress(sent / total),
        onError: (e) => { setProgress(null); setError(`Upload failed: ${e.message}`); },
        onSuccess: async () => {
          try {
            await api(`/api/projects/${project.id}/start`, { method: "POST", json: { objectName: upload.objectName } });
            router.push(`/projects/${project.id}`);
          } catch (e) {
            setProgress(null);
            setError(e instanceof Error ? e.message : "Could not start processing");
          }
        },
      });
      uploadRef.current = up;
      up.start();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  async function cancelUpload() {
    await uploadRef.current?.abort(true).catch(() => undefined);
    uploadRef.current = null;
    setProgress(null);
    if (projectRef.current) await api(`/api/projects/${projectRef.current}`, { method: "DELETE" }).catch(() => undefined);
    projectRef.current = null;
  }

  async function check() {
    setError(null);
    setMeta(null);
    setChecking(true);
    try {
      const r = await api<{ metadata: Meta }>("/api/projects/import-url", { method: "POST", json: { url } });
      setMeta(r.metadata);
      if (!r.metadata.importable && r.metadata.note) setError(r.metadata.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check that link");
    } finally {
      setChecking(false);
    }
  }

  async function startImport() {
    setStarting(true);
    setError(null);
    try {
      const r = await api<{ project: { id: string } }>("/api/projects/import-url", { method: "POST", json: { url, create: true, title: meta?.title } });
      await api(`/api/projects/${r.project.id}/start`, { method: "POST", json: {} });
      router.push(`/projects/${r.project.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the import");
      setStarting(false);
    }
  }

  const uploading = progress !== null;

  return (
    <div className="card p-6">
      <div className="mb-5 inline-flex rounded-xl border border-border bg-surface p-1 text-sm">
        {([["file", "Upload video", UploadCloud], ["url", "Paste a link", Link2]] as const).map(([id, label, Icon]) => (
          <button key={id} disabled={uploading} onClick={() => { setTab(id); setError(null); }}
            className={clsx("flex items-center gap-2 rounded-lg px-4 py-1.5 transition", tab === id ? "bg-card text-white" : "text-muted hover:text-white")}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "file" ? (
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (!uploading) pick(e.dataTransfer.files[0]); }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={clsx("flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition", drag ? "border-accent bg-accent/10" : "border-border hover:border-accent/60")}
          >
            <UploadCloud className="mb-3 h-8 w-8 text-accent-soft" />
            <p className="font-medium">{file ? file.name : "Drop a video here or click to browse"}</p>
            <p className="mt-1 text-sm text-muted">
              {file
                ? `${fmtBytes(file.size)}${fileDuration ? ` · ${fmtDuration(fileDuration)}` : ""}`
                : `MP4, MOV, MKV, AVI, WebM, WMV, FLV, MPEG, M4V, 3GP, TS, MTS and more · up to ${limits.maxUploadMb} MB / ${limits.maxVideoMinutes} min`}
            </p>
            <input ref={inputRef} type="file" accept="video/*,.mkv,.avi,.wmv,.flv,.mpeg,.mpg,.m4v,.3gp,.ts,.mts,.m2ts" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          {uploading && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-sm"><span>Uploading…</span><span>{Math.round((progress ?? 0) * 100)}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface"><div className="h-full bg-accent transition-all" style={{ width: `${(progress ?? 0) * 100}%` }} /></div>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            {!uploading ? (
              <button className="btn-primary" disabled={!file} onClick={startUpload}>Upload &amp; generate clips</button>
            ) : (
              <button className="btn-ghost" onClick={cancelUpload}><X className="h-4 w-4" /> Cancel upload</button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <input className="input" placeholder="https://www.youtube.com/watch?v=… or a direct video link" value={url} onChange={(e) => { setUrl(e.target.value); setMeta(null); }} onKeyDown={(e) => e.key === "Enter" && url && check()} />
            <button className="btn-ghost shrink-0" disabled={!url || checking} onClick={check}>{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check link"}</button>
          </div>
          {meta && (
            <div className="mt-4 flex gap-4 rounded-2xl border border-border bg-surface p-3">
              {meta.thumbnail && /* eslint-disable-next-line @next/next/no-img-element */ <img src={meta.thumbnail} alt="" className="h-20 w-36 rounded-lg object-cover" />}
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{meta.title ?? "Video"}</p>
                <p className="text-muted">{meta.platform}{meta.durationSeconds ? ` · ${fmtDuration(meta.durationSeconds)}` : ""}{meta.sizeBytes ? ` · ${fmtBytes(meta.sizeBytes)}` : ""}</p>
                <p className="mt-1 text-xs text-muted">Only import videos you own or have permission to use.</p>
              </div>
            </div>
          )}
          <div className="mt-4">
            <button className="btn-primary" disabled={!meta?.importable || starting} onClick={startImport}>
              {starting ? "Starting…" : "Import & generate clips"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
