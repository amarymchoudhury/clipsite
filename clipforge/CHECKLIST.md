# ClipForge: build checklist

`[x]` = source written. **Nothing below has been installed, built or run against real Supabase/Redis/OpenAI.**
`[T]` = covered by unit tests that pass. `[F]` = exercised with real FFmpeg in the sandbox.

## Foundation
- [x] package.json, tsconfig, .env.example, next/tailwind/postcss/eslint config, Dockerfile.worker, .gitignore
- [x] supabase/migrations 0001 (schema, RLS, private bucket + policies) and 0002 (pipeline columns)
- [x] env validation + honest setup status, shared types, errors

## Auth, data, security
- [x] Supabase clients (browser/server/admin), middleware, login/sign-up, auth callback
- [x] Owner checks on every route, RLS, signed URLs for all media, SSRF guard for URL import

## Upload / import
- [x] Resumable tus upload with progress + cancel, size/duration display, size limit
- [x] URL check (metadata) + import: direct links, optional yt-dlp; no DRM/paywall circumvention
- [x] FFprobe validation, normalisation to H.264/AAC MP4, thumbnails, clear errors

## AI pipeline
- [x] Chunked transcription with word timestamps, punctuation merge [T]
- [x] Whole-video windowed clip selection, hooks grounded in transcript, 9-factor scoring, dedupe, silence filter [T]
- [x] Provider interfaces (swap OpenAI in `src/lib/providers`)
- [ ] Speaker diarisation (not implemented; no provider wired)
- [ ] Face/speaker detection (motion-saliency heuristic only)
- [ ] Visual/scene analysis (transcript-only)

## Subtitles & rendering
- [x] 7 themes, per-clip AI recommendation, full style overrides, word-by-word highlight, emoji [T]
- [x] ASS burn-in, SRT, VTT, safe zones [T][F]
- [x] Layouts: fill, speaker, blur, split → 1080×1920 H.264/AAC [T][F]

## UI
- [x] Dashboard, Create, Projects, Project view (select/sort/search/filter/delete/regenerate/generate more), Library, Settings
- [x] Clip editor: live preview, trim, crop, layout, caption text/timing/style, hook, title, volume, AI improvements
- [x] Export dialog: presets (TikTok/Reels/Facebook/Shorts), burn on/off, SRT/VTT, ZIP

## Reliability
- [x] BullMQ queue, 3 retries with backoff, dedupe keys, status polling, failed-project retry, temp cleanup

## Docs & tests
- [x] README (setup, env, deploy, limitations, verification status)
- [x] Unit tests (25 passing in sandbox via shim; vitest config included)
- [ ] `npm install` / `typecheck` / `build` / end-to-end run with real credentials. **Do first.**
