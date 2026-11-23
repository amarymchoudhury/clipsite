import { describe, expect, it } from "vitest";
import { attachPunctuation, buildSentences } from "@/lib/clips/sentences";
import { buildCandidates, dedupe, isHookGrounded, longestSilence, overallScore, snapToSentences, type RawPick } from "@/lib/clips/postprocess";
import type { Word } from "@/lib/types";

/** Builds words at 3 words/second from sentence strings, with a pause between sentences. */
function make(sentences: string[], gap = 0.3): Word[] {
  const words: Word[] = [];
  let t = 0;
  for (const s of sentences) {
    for (const w of s.split(" ")) {
      words.push({ word: w, start: t, end: t + 0.3 });
      t += 0.33;
    }
    t += gap;
  }
  return words;
}

const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + ".";

describe("sentences", () => {
  it("splits on terminal punctuation", () => {
    const s = buildSentences(make(["Hello there.", "How are you?", "Fine thanks!"]));
    expect(s.map((x) => x.text)).toEqual(["Hello there.", "How are you?", "Fine thanks!"]);
  });

  it("splits on long pauses even without punctuation", () => {
    const s = buildSentences(make(["no punctuation here", "still none here"], 2));
    expect(s).toHaveLength(2);
  });

  it("copies punctuation from segments onto words", () => {
    const words: Word[] = ["hello", "world", "again"].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
    const out = attachPunctuation(words, [{ text: "Hello, world. Again!", start: 0, end: 2.5 }]);
    expect(out.map((w) => w.word)).toEqual(["Hello,", "world.", "Again!"]);
  });
});

describe("snapToSentences", () => {
  const words = make(Array.from({ length: 12 }, () => long(9)), 0.4); // ~3.4s per sentence
  const sentences = buildSentences(words);

  it("extends to reach the minimum length using whole sentences", () => {
    const r = snapToSentences(3, 3, sentences, 10, 60, 100)!;
    expect(r.end - r.start).toBeGreaterThanOrEqual(10);
    // boundaries sit on sentence edges (± small lead-in/out)
    expect(r.start).toBeLessThanOrEqual(sentences[r.startSentence].start);
    expect(r.end).toBeGreaterThanOrEqual(sentences[r.endSentence].end);
  });

  it("shrinks to stay under the maximum length", () => {
    const r = snapToSentences(0, 11, sentences, 10, 20, 100)!;
    expect(r.end - r.start).toBeLessThanOrEqual(20);
  });

  it("never overlaps neighbouring sentences' speech", () => {
    const r = snapToSentences(4, 6, sentences, 10, 60, 100)!;
    expect(r.start).toBeGreaterThanOrEqual(sentences[r.startSentence - 1].end);
    expect(r.end).toBeLessThanOrEqual(sentences[r.endSentence + 1].start);
  });

  it("returns null when no valid range exists", () => {
    expect(snapToSentences(0, 0, buildSentences(make(["Short."])), 10, 60, 3)).toBeNull();
  });
});

describe("scoring and hooks", () => {
  const b = { opening: 8, entertainment: 8, standalone: 8, pacing: 8, emotion: 8, interest: 8, avQuality: 8, ending: 8, retention: 8 };
  it("scores on a 0-100 scale", () => {
    expect(overallScore(b)).toBe(80);
    expect(overallScore({ ...b, opening: 99 as number })).toBeLessThanOrEqual(100);
  });

  it("accepts hooks only when grounded in the clip text", () => {
    const text = "I never thought we would actually win the whole thing.";
    expect(isHookGrounded("never thought we would actually win", text)).toBe(true);
    expect(isHookGrounded("lost everything overnight", text)).toBe(false);
    expect(isHookGrounded("win", text)).toBe(false); // too short to count
    expect(isHookGrounded(undefined, text)).toBe(false);
  });

  it("measures the longest silence in a clip", () => {
    const w = [{ word: "a", start: 0, end: 1 }, { word: "b", start: 5, end: 6 }];
    expect(longestSilence(w, 0, 6)).toBeCloseTo(4);
  });
});

describe("buildCandidates", () => {
  const words = make(Array.from({ length: 30 }, (_, i) => `Sentence ${i} ${long(9)}`), 0.4);
  const sentences = buildSentences(words);
  const dur = words[words.length - 1].end + 1;
  const good = { opening: 9, entertainment: 8, standalone: 9, pacing: 8, emotion: 7, interest: 8, avQuality: 8, ending: 8, retention: 8 };
  const pick = (s: number, e: number, scores = good): RawPick => ({ startSentence: s, endSentence: e, title: `Clip ${s}`, scores });

  it("drops near-duplicates, keeping the higher score", () => {
    const out = buildCandidates([pick(2, 6), pick(3, 7, { ...good, opening: 6 })], sentences, words, { minSeconds: 10, maxSeconds: 60, durationSeconds: dur });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Clip 2");
  });

  it("filters low-scoring picks", () => {
    const weak = Object.fromEntries(Object.keys(good).map((k) => [k, 3])) as typeof good;
    expect(buildCandidates([pick(2, 6, weak)], sentences, words, { minSeconds: 10, maxSeconds: 60, durationSeconds: dur })).toHaveLength(0);
  });

  it("removes a hook that isn't supported by the clip", () => {
    const out = buildCandidates([{ ...pick(2, 6), hook: "You won't believe this", hookGrounding: "a phrase never spoken here" }], sentences, words, { minSeconds: 10, maxSeconds: 60, durationSeconds: dur });
    expect(out[0].hook).toBe("");
  });

  it("dedupe keeps non-overlapping clips", () => {
    const kept = dedupe([{ start: 0, end: 20, score: 80 }, { start: 30, end: 50, score: 70 }]);
    expect(kept).toHaveLength(2);
  });
});
