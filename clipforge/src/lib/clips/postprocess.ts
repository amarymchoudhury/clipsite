import type { ClipCandidate, ClipCategory, ScoreBreakdown, SubtitleThemeId, Word } from "@/lib/types";
import { CLIP_CATEGORIES, SUBTITLE_THEMES } from "@/lib/types";
import type { Sentence } from "./sentences";

export interface RawPick {
  startSentence: number;
  endSentence: number;
  title: string;
  description?: string;
  hook?: string;
  hookGrounding?: string;
  category?: string;
  theme?: string;
  scores: ScoreBreakdown;
}

export const MIN_ACCEPTED_SCORE = 60;

const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  opening: 2,
  entertainment: 1.5,
  standalone: 2,
  pacing: 1,
  emotion: 1,
  interest: 1.5,
  avQuality: 0.5,
  ending: 1.5,
  retention: 2,
};

/** Overall 0–100 score computed in code from the model's 0–10 sub-scores (never trusted directly). */
export function overallScore(b: ScoreBreakdown): number {
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]) {
    sum += Math.max(0, Math.min(10, b[k] ?? 0)) * WEIGHTS[k];
    w += WEIGHTS[k];
  }
  return Math.round((sum / w) * 10 * 10) / 10;
}

const normText = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

/** A hook is only kept if the model quotes (verbatim) something actually said in the clip that supports it. */
export function isHookGrounded(grounding: string | undefined, clipText: string): boolean {
  if (!grounding) return false;
  const g = normText(grounding);
  if (g.split(" ").length < 3) return false;
  return normText(clipText).includes(g);
}

export function longestSilence(words: Word[], start: number, end: number): number {
  const inRange = words.filter((w) => w.end > start && w.start < end);
  if (!inRange.length) return end - start;
  let longest = Math.max(0, inRange[0].start - start);
  for (let i = 1; i < inRange.length; i++) longest = Math.max(longest, inRange[i].start - inRange[i - 1].end);
  return Math.max(longest, end - inRange[inRange.length - 1].end);
}

export interface SnapResult {
  start: number;
  end: number;
  startSentence: number;
  endSentence: number;
}

/**
 * Convert a sentence range to clean time boundaries: whole sentences only, a small lead-in/out,
 * duration forced into [min,max] by adding/removing whole sentences. Returns null if impossible.
 */
export function snapToSentences(
  startSentence: number,
  endSentence: number,
  sentences: Sentence[],
  minSeconds: number,
  maxSeconds: number,
  durationSeconds: number,
): SnapResult | null {
  if (!sentences.length) return null;
  const last = sentences.length - 1;
  let s = Math.max(0, Math.min(last, Math.round(startSentence)));
  let e = Math.max(s, Math.min(last, Math.round(endSentence)));

  const bounds = (a: number, b: number) => {
    const prevEnd = a > 0 ? sentences[a - 1].end : 0;
    const nextStart = b < last ? sentences[b + 1].start : durationSeconds;
    const start = Math.max(prevEnd + 0.02, sentences[a].start - 0.2, 0);
    const end = Math.min(nextStart - 0.02, sentences[b].end + 0.3, durationSeconds);
    return { start: Math.min(start, sentences[a].start), end: Math.max(end, sentences[b].end) };
  };

  let { start, end } = bounds(s, e);
  while (end - start > maxSeconds && e > s) {
    e--;
    ({ start, end } = bounds(s, e));
  }
  if (end - start > maxSeconds) return null;
  while (end - start < minSeconds && (e < last || s > 0)) {
    if (e < last) e++;
    else s--;
    ({ start, end } = bounds(s, e));
  }
  // extending may have overshot max; fall back to dropping the tail again
  while (end - start > maxSeconds && e > s) {
    e--;
    ({ start, end } = bounds(s, e));
  }
  if (end - start < minSeconds || end - start > maxSeconds) return null;
  return { start, end, startSentence: s, endSentence: e };
}

export function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const minLen = Math.min(a.end - a.start, b.end - b.start);
  return minLen > 0 ? inter / minLen : 0;
}

/** Highest score wins; anything overlapping a kept clip by ≥ threshold is dropped as a near-duplicate. */
export function dedupe<T extends { start: number; end: number; score: number }>(cands: T[], threshold = 0.35): T[] {
  const sorted = [...cands].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const c of sorted) if (!kept.some((k) => overlapRatio(k, c) >= threshold)) kept.push(c);
  return kept;
}

const CATEGORY_THEME: Record<ClipCategory, SubtitleThemeId> = {
  funny: "energetic",
  surprising: "karaoke",
  educational: "minimal",
  inspirational: "creator",
  story: "bold",
  debate: "bold",
  opinion: "bold",
  qa: "documentary",
  quote: "cinematic",
  visual: "minimal",
};

export function toCategory(v: string | undefined): ClipCategory {
  return (CLIP_CATEGORIES as readonly string[]).includes(v ?? "") ? (v as ClipCategory) : "story";
}
export function toTheme(v: string | undefined, category: ClipCategory): SubtitleThemeId {
  return (SUBTITLE_THEMES as readonly string[]).includes(v ?? "") ? (v as SubtitleThemeId) : CATEGORY_THEME[category];
}

export interface BuildOptions {
  minSeconds: number;
  maxSeconds: number;
  durationSeconds: number;
  minScore?: number;
}

export function buildCandidates(
  picks: RawPick[],
  sentences: Sentence[],
  words: Word[],
  opts: BuildOptions,
): ClipCandidate[] {
  const out: ClipCandidate[] = [];
  for (const p of picks) {
    const snap = snapToSentences(p.startSentence, p.endSentence, sentences, opts.minSeconds, opts.maxSeconds, opts.durationSeconds);
    if (!snap) continue;
    if (longestSilence(words, snap.start, snap.end) > 2.5) continue;
    const score = overallScore(p.scores);
    if (score < (opts.minScore ?? MIN_ACCEPTED_SCORE)) continue;
    const clipText = sentences.slice(snap.startSentence, snap.endSentence + 1).map((s) => s.text).join(" ");
    const category = toCategory(p.category);
    const title = (p.title || "Untitled clip").trim().slice(0, 100);
    const hook = isHookGrounded(p.hookGrounding, clipText) ? (p.hook ?? "").trim().slice(0, 90) : "";
    out.push({
      title,
      description: (p.description ?? "").trim().slice(0, 300),
      hook,
      category,
      start: snap.start,
      end: snap.end,
      score,
      breakdown: p.scores,
      suggestedTheme: toTheme(p.theme, category),
    });
  }
  return dedupe(out).sort((a, b) => b.score - a.score);
}
