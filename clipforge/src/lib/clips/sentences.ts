import type { Segment, Word } from "@/lib/types";

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  speaker?: string;
  /** word index range [wordStart, wordEnd) in the transcript word array */
  wordStart: number;
  wordEnd: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Whisper's word list is usually unpunctuated while segment text is punctuated.
 * Copy punctuated/capitalised tokens from segments onto the words they match.
 */
export function attachPunctuation(words: Word[], segments: Segment[]): Word[] {
  const out = words.map((w) => ({ ...w }));
  let wi = 0;
  for (const seg of segments) {
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    while (wi < out.length && out[wi].end < seg.start - 0.05) wi++;
    let ti = 0;
    let k = wi;
    while (ti < tokens.length && k < out.length && out[k].start <= seg.end + 0.05) {
      const tn = norm(tokens[ti]);
      if (tn === "") {
        ti++; // stray punctuation token
      } else if (norm(out[k].word) === tn) {
        out[k].word = tokens[ti];
        ti++;
        k++;
      } else if (ti + 1 < tokens.length && norm(out[k].word) === norm(tokens[ti + 1])) {
        ti++;
      } else if (k + 1 < out.length && norm(out[k + 1].word) === tn) {
        k++;
      } else {
        ti++;
        k++;
      }
    }
    wi = k;
  }
  return out;
}

const END_RE = /[.?!…]["')\]]*$/;

/** Split words into sentences on terminal punctuation, long pauses, or length. */
export function buildSentences(words: Word[], maxWords = 45, pauseSeconds = 0.9): Sentence[] {
  const sentences: Sentence[] = [];
  let startIdx = 0;
  const flush = (endIdx: number) => {
    if (endIdx <= startIdx) return;
    const slice = words.slice(startIdx, endIdx);
    sentences.push({
      index: sentences.length,
      text: slice.map((w) => w.word).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      speaker: slice[0].speaker,
      wordStart: startIdx,
      wordEnd: endIdx,
    });
    startIdx = endIdx;
  };
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const gap = next ? next.start - words[i].end : Infinity;
    const speakerChange = next && next.speaker !== words[i].speaker;
    if (END_RE.test(words[i].word) || gap > pauseSeconds || speakerChange || i + 1 - startIdx >= maxWords) {
      flush(i + 1);
    }
  }
  flush(words.length);
  return sentences;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(r).padStart(2, "0")}`;
}
