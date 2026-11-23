# ClipForge: AI video clipping platform

Upload a long video (or paste a link), let AI find the best standalone moments, then preview, edit, caption and export
vertical 1080×1920 clips for TikTok, Instagram Reels, Facebook Reels and YouTube Shorts.

> **Status, read this first.** All source code is written and the pure logic (clip selection post-processing, captions,
> ASS/SRT/VTT generation, FFmpeg filter graphs) has unit tests and was rendered with real FFmpeg. The full app,
> **has not been installed, type-checked with its real dependencies, built, or run end-to-end against Supabase,
> Redis and OpenAI.** Expect to fix a few small errors on first `npm run typecheck` / `npm run build`. See
> [Verification status](#verification-status).

## How it works

```
Browser ──(resumable upload, tus)──▶ Supabase Storage (private bucket)
   │                                         ▲
   ├── Next.js app (UI + API routes) ──▶ Supabase Postgres (RLS)        ──▶ Redis (BullMQ queue)
   │                                                                          │
   └── polls /api/projects/:id/status                      Worker (Node + FFmpeg) ◀┘
                                                              ingest → transcribe → analyze → render → export
                                                              └─▶ OpenAI (Whisper + GPT-4o)
```

1. **Ingest** – downloads the upload (or imports a URL), validates with FFprobe (real codec/container, not the file
   extension), converts non-H.264/AAC sources to MP4, makes a thumbnail.
2. **Transcribe** – extracts 16 kHz audio in 10-minute chunks, transcribes with word-level timestamps, re-adds
   punctuation to the word list.
3. **Analyze** – splits the transcript into sentences, scans the **entire** video in overlapping ~12-minute windows
   with a whole-video summary as context, and asks the LLM for standalone moments with sub-scores. Code then
   - snaps every clip to whole-sentence boundaries (never mid-sentence) and enforces 10–60 s,
   - rejects clips with >2.5 s of dead air,
   - computes the 0–100 score itself from the model's sub-scores and drops anything under 60,
   - removes near-duplicates (≥35 % overlap, keeps the higher score),
   - keeps a hook **only** if the model quotes a verbatim phrase from the clip that supports it.
4. **Render** – 1080×1920 H.264/AAC MP4 with the chosen layout, burned-in ASS captions and optional hook overlay.
5. **Export** – re-renders selected clips with a platform preset; one clip → MP4, several → ZIP; optional SRT/VTT.

## What must be hosted where

GitHub only stores the code. It does not run databases, workers or FFmpeg.

| Component | What | Where (examples) | Needs |
|---|---|---|---|
| Web app | Next.js UI + API | Vercel, Netlify, any Node host, Docker | Env vars (below) |
| Worker | `npm run worker`, **needs FFmpeg** | Railway, Fly.io, Render, a VPS (use `Dockerfile.worker`) | Same env vars + FFmpeg + disk |
| Database, auth, storage | Postgres, email auth, private bucket | Supabase | Project + migrations |
| Queue | BullMQ | Upstash, Redis Cloud, self-hosted Redis | `REDIS_URL` |
| AI | Whisper + GPT-4o | OpenAI | **Paid** API key |

The worker is a long-running process and cannot run on serverless platforms such as Vercel.

## Requirements and paid services

- Node.js 20+ and npm
- FFmpeg + FFprobe with libx264, libmp3lame and libass (worker only; most distro builds have all three)
  - macOS `brew install ffmpeg` · Ubuntu/Debian `sudo apt install ffmpeg` · Windows `winget install ffmpeg`
  - Fonts used for captions: DejaVu Sans and Liberation (preinstalled on most Linux; `apt install fonts-dejavu fonts-liberation`)
- **Supabase** project (free tier works for trying it, see the file-size limit below)
- **Redis** (local `docker run -p 6379:6379 redis:7` or a hosted instance)
- **OpenAI API key** with billing (transcription ≈ $0.006/min of audio; analysis costs a few cents per hour of video)
- Optional: **yt-dlp** on the worker for YouTube and other platform links

## Setup

```bash
git clone <your-repo-url> clipforge && cd clipforge
npm install
cp .env.example .env.local          # Next.js reads .env.local; the worker reads .env.local then .env
```

### 1. Supabase

1. Create a project at supabase.com. Copy the URL, anon key and service-role key into `.env.local`.
2. Run the migrations in order in the SQL editor (or `supabase db push` with the CLI):
   `supabase/migrations/0001_init.sql`, then `0002_pipeline_columns.sql`. This creates the tables, row-level
   security (users can only see their own rows), and the **private** `videos` storage bucket with per-user policies.
3. **Upload size:** Supabase limits file size per plan: **50 MB on the free plan**. For long videos use a paid plan and
   raise *Storage → Settings → Global file size limit* (and keep `MAX_UPLOAD_MB` at or below it). Until then, only small
   videos upload.
4. *Authentication → URL configuration:* add your site URL (and `http://localhost:3000/auth/callback`) so email
   confirmation links work. For quick local testing you can disable "Confirm email".

### 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Browser/server auth |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server + worker only. **Never expose it.** |
| `SUPABASE_STORAGE_BUCKET` | yes | Bucket name (`videos`, created by the migration) |
| `REDIS_URL` | yes | Job queue (`rediss://…` for TLS providers) |
| `OPENAI_API_KEY` | yes for AI | Without it, jobs stop with a clear "setup required" error and the UI shows a banner |
| `TRANSCRIPTION_PROVIDER`, `LLM_PROVIDER` | no | `openai` (default). Add providers in `src/lib/providers/` |
| `OPENAI_TRANSCRIBE_MODEL`, `OPENAI_LLM_MODEL` | no | Defaults `whisper-1`, `gpt-4o` (`whisper-1` is required for word timestamps) |
| `MAX_UPLOAD_MB`, `MAX_VIDEO_MINUTES` | no | Admin limits (defaults 4096 MB / 180 min) |
| `MIN_CLIP_SECONDS`, `MAX_CLIP_SECONDS` | no | Clip length window (10 / 60) |
| `WORKER_CONCURRENCY` | no | Parallel jobs per worker (default 2; rendering is CPU-heavy) |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `TMP_DIR` | no | Worker paths (temp files are auto-cleaned after 6 h idle) |
| `YTDLP_PATH` | no | Enables YouTube/other site import (e.g. `yt-dlp`). Direct video links work without it |

The worker needs the same variables as the web app in **its own** environment.

### 3. Run locally

```bash
npm run dev       # web app on http://localhost:3000
npm run worker    # in a second terminal: processes jobs (checks FFmpeg on start)
```

Sign up, upload a video with clear speech, and watch the project page. If it sits on "Waiting for a worker", the
worker isn't running or can't reach Redis.

### Commands

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
npm test            # vitest (unit tests in tests/)
npm run build && npm start
```

## Deploying

**Web app (Vercel):** import the repo, set the variables above, deploy. Redis and Supabase must be reachable from it.
The AI-refine route can take up to ~20 s; on Vercel Hobby (short function limits) it may time out. Use Pro or a Node/Docker host.

**Worker (Railway / Fly / Render / VPS):** build from `Dockerfile.worker` (installs FFmpeg), or `npm ci && npm run worker`
on a machine with FFmpeg. Give it ≥2 vCPU, ≥4 GB RAM and disk for the largest source video (copies live in `TMP_DIR`).
Scale by running more worker instances; BullMQ distributes jobs, and `WORKER_CONCURRENCY` tunes each one. Set
`YTDLP_PATH` and install yt-dlp in the image if you want platform imports.

**Redis:** BullMQ works with Upstash/Redis Cloud. Use the `rediss://` URL; avoid "serverless per-request" pricing
for a polling worker, or use a fixed plan.

## Features and where they live

| Feature | Location |
|---|---|
| Upload (resumable/chunked, cancel, progress) | `src/components/UploadPanel.tsx` (tus → Supabase) |
| URL import (SSRF-guarded; yt-dlp optional) | `src/lib/url.ts`, `worker/import.ts` |
| FFprobe validation + normalisation | `worker/ffmpeg.ts`, `worker/jobs/ingest.ts` |
| Transcription, clip selection, hooks, scoring | `worker/jobs/transcribe.ts`, `src/lib/providers/`, `src/lib/clips/` |
| Subtitle themes, ASS/SRT/VTT, safe zones | `src/lib/subtitles/` |
| Reframing layouts (fill / speaker / blur / split) | `src/lib/render/filters.ts`, `worker/render.ts`, `worker/framing.ts` |
| Clip grid: select, sort, search, filter, delete, regenerate, generate more | `src/components/ProjectView.tsx` |
| Editor: trim, crop, layout, captions text/timing/style, hook, volume, AI improvements | `src/components/ClipEditor.tsx`, `src/app/api/clips/[id]/` |
| Export: presets, ZIP, burned-in or clean, SRT/VTT | `src/components/ExportDialog.tsx`, `worker/jobs/export.ts` |
| Queue, retries (3×, backoff), dedupe, failed-job retry, cleanup | `src/lib/jobs.ts`, `worker/index.ts`, `/api/projects/[id]/retry` |
| Auth + per-user isolation | Supabase Auth, RLS policies, `src/middleware.ts`, owner checks in `src/lib/api.ts` |

## Known limitations (honest list)

- **Smart framing is a heuristic.** Focus is the horizontal centroid of motion and detail sampled at 2 fps. It tracks
  talking heads reasonably but is **not face or speaker detection**, so it can't pick the "active speaker" between two
  still people. Use the crop slider, the Split layout (side-by-side sources) or swap `worker/framing.ts` for a real
  detector; the pipeline only needs a number.
- **No speaker diarisation.** Whisper doesn't provide it, so captions carry no speaker labels. The data model
  (`speaker` on words/segments) is ready for a diarising provider.
- **Analysis is transcript-based.** Visual-only moments aren't detected (no scene/visual model).
- **No background music.** The editor adjusts original-audio volume only.
- The editor preview approximates the final render using the source video and CSS; exact crop/caption rendering
  happens in the final MP4.
- Caption emoji are added by a small keyword map; the default fonts have no colour emoji, so enable Emoji only if
  your worker has a colour-emoji font installed (e.g. `fonts-noto-color-emoji`).
- Clip quality depends on the model and on the transcript; the scoring and filters reduce weak clips but cannot
  guarantee every clip is good.
- URL import only fetches what a plain download or yt-dlp is permitted to. Private, paywalled or DRM-protected
  media fails with a message; there is no circumvention. Only import content you own or have permission to use.

## Verification status

Done here (Linux sandbox, no network installs):

- 25 unit tests pass (`tests/`): sentence building, punctuation merge, sentence snapping, min/max length,
  dedupe, scoring, hook grounding, silence detection, cue grouping, SRT/VTT, ASS for all 7 themes, filter graphs.
- Real FFmpeg renders of all four layouts with captions + hook produced 1080×1920 H.264 files, and frames were inspected.
- A partial `tsc` run found no non-dependency errors in the code (dependencies weren't installable).

**Not done, do these first:** `npm install`, `npm run typecheck`, `npm run build`, then an end-to-end run with real
Supabase, Redis and OpenAI credentials (upload → clips → edit → export). The Supabase resumable upload, the OpenAI
word-timestamp response shape, and the storage policies are the most likely places to need adjustment.

## Project layout

```
src/app/            Next.js pages + API routes ((app) = signed-in area)
src/components/     UI (UploadPanel, ProjectView, ClipEditor, ExportDialog…)
src/lib/            shared logic: env, providers, clips, subtitles, render, supabase, queue, url
worker/             background worker: ingest/transcribe/analyze/render/export, FFmpeg helpers
supabase/migrations SQL schema, RLS and storage policies
tests/              vitest unit tests
CHECKLIST.md        build checklist
```

## Troubleshooting

- *"Setup required" banner / job failed with "OPENAI_API_KEY"*: set it in the **worker's** environment too, then Retry.
- *Stuck on "Waiting for a worker"*: start `npm run worker`; check `REDIS_URL`.
- *Upload fails at ~50 MB*: Supabase plan/global file-size limit (see Setup §1.3).
- *"ffmpeg was not found"*: install FFmpeg or set `FFMPEG_PATH`/`FFPROBE_PATH`.
- *Captions use a wrong font*: install `fonts-dejavu fonts-liberation` on the worker.
