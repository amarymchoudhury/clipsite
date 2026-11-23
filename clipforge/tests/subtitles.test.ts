import { describe, expect, it } from "vitest";
import { cuesFromOverrides, cuesFromWords } from "@/lib/subtitles/cues";
import { toSrt, toVtt } from "@/lib/subtitles/formats";
import { assColor, generateAss } from "@/lib/subtitles/ass";
import { resolveStyle, THEMES } from "@/lib/subtitles/themes";
import { buildFilterComplex } from "@/lib/render/filters";
import { SUBTITLE_THEMES } from "@/lib/types";

const words = "This is a pretty long sentence, with several words in it. And another one follows!".split(" ").map((w, i) => ({ word: w, start: 10 + i * 0.4, end: 10 + i * 0.4 + 0.35 }));

describe("cues", () => {
  it("groups words, makes times clip-relative and respects max words", () => {
    const cues = cuesFromWords(words, 10, 20, { maxWordsPerCue: 4, emoji: false });
    expect(cues[0].start).toBeCloseTo(0);
    expect(cues.every((c) => c.text.split(" ").length <= 4)).toBe(true);
    expect(cues.map((c) => c.text).join(" ")).toBe(words.map((w) => w.word).join(" "));
  });

  it("breaks cues at sentence ends", () => {
    const cues = cuesFromWords(words, 10, 20, { maxWordsPerCue: 8, emoji: false });
    expect(cues.some((c) => c.text.endsWith("it."))).toBe(true);
  });

  it("converts absolute manual overrides into clip-relative cues and clips them to range", () => {
    const cues = cuesFromOverrides([{ start: 9, end: 12, text: " Hi " }, { start: 30, end: 31, text: "outside" }], 10, 20, { emoji: false });
    expect(cues).toEqual([{ start: 0, end: 2, text: "Hi" }]);
  });
});

describe("subtitle files", () => {
  const cues = [{ start: 0, end: 1.5, text: "Hello" }, { start: 3725.123, end: 3726, text: "World" }];
  it("writes SRT with comma milliseconds", () => {
    expect(toSrt(cues)).toContain("00:00:00,000 --> 00:00:01,500");
    expect(toSrt(cues)).toContain("01:02:05,123 --> 01:02:06,000");
  });
  it("writes VTT with a header and dot milliseconds", () => {
    expect(toVtt(cues).startsWith("WEBVTT")).toBe(true);
    expect(toVtt(cues)).toContain("00:00:00.000 --> 00:00:01.500");
  });
});

describe("ASS", () => {
  it("converts colours to BGR with alpha", () => {
    expect(assColor("#FF0000")).toBe("&H000000FF");
    expect(assColor("#00FF00", 0.5)).toBe("&H8000FF00");
  });

  it("generates a document for every theme", () => {
    const cues = cuesFromWords(words, 10, 20, { maxWordsPerCue: 4, emoji: true });
    for (const t of SUBTITLE_THEMES) {
      const ass = generateAss({ cues, style: THEMES[t].style, hook: "A true hook", durationSeconds: 10, showSubtitles: true });
      expect(ass).toContain("PlayResX: 1080");
      expect(ass).toContain("Style: Sub,");
      expect(ass.match(/^Dialogue:/gm)!.length).toBeGreaterThan(cues.length - 1);
    }
  });

  it("strips override-injection characters from text", () => {
    const ass = generateAss({ cues: [{ start: 0, end: 1, text: "bad {\\an9} text" }], style: resolveStyle("minimal"), durationSeconds: 5, showSubtitles: true });
    expect(ass).not.toContain("{\\an9}");
  });

  it("omits captions when disabled but keeps the hook", () => {
    const ass = generateAss({ cues: [{ start: 0, end: 1, text: "hi" }], style: resolveStyle("bold"), hook: "Hook", durationSeconds: 5, showSubtitles: false });
    expect(ass).toContain(",Hook,");
    expect(ass).not.toContain(",Sub,,");
  });
});

describe("filter graph", () => {
  it("builds each layout to [v] at 1080x1920", () => {
    for (const layout of ["fill", "speaker", "blur", "split"] as const) {
      const g = buildFilterComplex({ layout, srcW: 1920, srcH: 1080, cx: 0.4, assFile: "s.ass" });
      expect(g.endsWith("[v]")).toBe(true);
      expect(g).toContain("ass=s.ass");
    }
    expect(buildFilterComplex({ layout: "fill", srcW: 1920, srcH: 1080, cx: 0.5, assFile: null })).toContain("crop=1080:1920");
  });

  it("keeps the crop window inside the scaled frame", () => {
    const g = buildFilterComplex({ layout: "fill", srcW: 1920, srcH: 1080, cx: 1, assFile: null });
    const [, w, , x] = g.match(/scale=(\d+):(\d+),crop=1080:1920:(\d+):(\d+)/)!;
    expect(Number(x) + 1080).toBeLessThanOrEqual(Number(w));
  });
});
