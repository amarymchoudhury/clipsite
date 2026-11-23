import { UploadPanel } from "@/components/UploadPanel";

export default function CreatePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Create clips</h1>
      <p className="mb-6 mt-1 text-muted">Upload a video or paste a link. The AI analyses the whole video and returns only moments worth posting.</p>
      <UploadPanel />
      <div className="mt-8 grid gap-4 text-sm text-muted sm:grid-cols-3">
        <div className="card p-4"><p className="mb-1 font-medium text-white">1. Analyse</p>Full transcription with word timestamps, then context-aware moment selection across the entire video.</div>
        <div className="card p-4"><p className="mb-1 font-medium text-white">2. Choose</p>Preview scored clips, pick your favourites, edit captions, hooks and framing.</div>
        <div className="card p-4"><p className="mb-1 font-medium text-white">3. Export</p>Download 1080×1920 MP4s with burned-in captions, plus SRT/VTT, tuned per platform.</div>
      </div>
    </div>
  );
}
