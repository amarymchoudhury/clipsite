export interface Word {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface Segment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface Transcript {
  language: string;
  text: string;
  words: Word[];
  segments: Segment[];
}

export interface ScoreBreakdown {
  opening: number;
  entertainment: number;
  standalone: number;
  pacing: number;
  emotion: number;
  interest: number;
  avQuality: number;
  ending: number;
  retention: number;
}

export interface ClipCandidate {
  title: string;
  description: string;
  hook: string;
  category: ClipCategory;
  start: number;
  end: number;
  score: number;
  breakdown: ScoreBreakdown;
  suggestedTheme: SubtitleThemeId;
}

export const CLIP_CATEGORIES = [
  "funny",
  "surprising",
  "educational",
  "inspirational",
  "story",
  "debate",
  "opinion",
  "qa",
  "quote",
  "visual",
] as const;
export type ClipCategory = (typeof CLIP_CATEGORIES)[number];

export const SUBTITLE_THEMES = [
  "bold",
  "creator",
  "minimal",
  "karaoke",
  "documentary",
  "energetic",
  "cinematic",
] as const;
export type SubtitleThemeId = (typeof SUBTITLE_THEMES)[number];

export type ClipLayout = "fill" | "speaker" | "blur" | "split";

export type JobKind = "ingest" | "transcribe" | "analyze" | "render" | "export";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface QueuePayload {
  jobId: string;
  userId: string;
  projectId: string;
  clipId?: string;
  exportId?: string;
}
