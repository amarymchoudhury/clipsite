import type { Word } from "@/lib/types";
import type { SubtitleStyle } from "./themes";

export interface CueWord {
  word: string;
  start: number;
  end: number;
}
/** Times are seconds relative to the start of the clip. */
export interface Cue {
  start: number;
  end: number;
  text: string;
  words?: CueWord[];
}

export interface CueOverride {
  /** absolute (source-timeline) seconds */
  start: number;
  end: number;
  text: string;
}

const EMOJI: [RegExp, string][] = [
  [/\b(laugh\w*|funny|hilarious|joke\w*|lol)\b/i, "😂"],
  [/\b(money|cash|dollars?|rich|million\w*|billion\w*)\b/i, "💰"],
  [/\b(love\w*|heart)\b/i, "❤️"],
  [/\b(fire|hot|amazing|insane|crazy)\b/i, "🔥"],
  [/\b(shock\w*|wow|unbelievable|surpris\w*)\b/i, "😲"],
  [/\b(idea|think|smart|brain)\b/i, "🧠"],
  [/\b(win|won|winner|success\w*|best)\b/i, "🏆"],
  [/\b(sad|cry\w*|lost|died|death)\b/i, "😢"],
];

export function addEmoji(text: string): string {
  for (const [re, e] of EMOJI) if (re.test(text)) return `${text} ${e}`;
  return text;
}

/** Group words in [clipStart, clipEnd] into short caption cues suited to mobile. */
export function cuesFromWords(words: Word[], clipStart: number, clipEnd: number, style: Pick<SubtitleStyle, "maxWordsPerCue" | "emoji">): Cue[] {
  const dur = clipEnd - clipStart;
  const inRange = words.filter((w) => w.end > clipStart && w.start < clipEnd);
  const cues: Cue[] = [];
  let cur: CueWord[] = [];

  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.word).join(" ");
    cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: style.emoji ? addEmoji(text) : text, words: cur });
    cur = [];
  };

  for (let i = 0; i < inRange.length; i++) {
    const w = inRange[i];
    cur.push({
      word: w.word,
      start: Math.max(0, w.start - clipStart),
      end: Math.min(dur, Math.max(w.end - clipStart, w.start - clipStart + 0.05)),
    });
    const next = inRange[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const hardBreak = /[.?!…]["')\]]*$/.test(w.word);
    const softBreak = /[,;:]["')\]]*$/.test(w.word) && cur.length >= Math.ceil(style.maxWordsPerCue / 2);
    if (cur.length >= style.maxWordsPerCue || hardBreak || softBreak || gap > 0.6) flush();
  }
  flush();

  // Hold each cue until the next one begins (max +0.25s) so captions don't flicker.
  for (let i = 0; i < cues.length; i++) {
    const nextStart = i + 1 < cues.length ? cues[i + 1].start : dur;
    cues[i].end = Math.min(nextStart, cues[i].end + 0.25, dur);
  }
  return cues;
}

/** Manual edits (absolute timeline) → clip-relative cues, clipped to the clip range. */
export function cuesFromOverrides(overrides: CueOverride[], clipStart: number, clipEnd: number, style: Pick<SubtitleStyle, "emoji">): Cue[] {
  const dur = clipEnd - clipStart;
  return overrides
    .filter((o) => o.end > clipStart && o.start < clipEnd && o.text.trim())
    .map((o) => ({
      start: Math.max(0, o.start - clipStart),
      end: Math.min(dur, o.end - clipStart),
      text: style.emoji ? addEmoji(o.text.trim()) : o.text.trim(),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

export function cuesForClip(
  words: Word[],
  overrides: CueOverride[] | null | undefined,
  clipStart: number,
  clipEnd: number,
  style: Pick<SubtitleStyle, "maxWordsPerCue" | "emoji">,
): Cue[] {
  return overrides && overrides.length
    ? cuesFromOverrides(overrides, clipStart, clipEnd, style)
    : cuesFromWords(words, clipStart, clipEnd, style);
}

/** Cues in absolute time for the editor (so edits survive re-trimming). */
export function toAbsoluteOverrides(cues: Cue[], clipStart: number): CueOverride[] {
  return cues.map((c) => ({ start: c.start + clipStart, end: c.end + clipStart, text: c.text }));
}
