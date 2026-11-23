import OpenAI from "openai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { ClipCandidate, Transcript } from "@/lib/types";
import { buildSentences, fmtTime, type Sentence } from "@/lib/clips/sentences";
import { buildCandidates, snapToSentences, toCategory, toTheme, isHookGrounded, type RawPick } from "@/lib/clips/postprocess";
import { ProviderNotConfiguredError, type AnalyzeOptions, type LlmProvider } from "./types";

const score = z.coerce.number().transform((n) => Math.max(0, Math.min(10, n)));
const pickSchema = z.object({
  startSentence: z.coerce.number(),
  endSentence: z.coerce.number(),
  title: z.string(),
  description: z.string().optional(),
  hook: z.string().optional(),
  hookGrounding: z.string().optional(),
  category: z.string().optional(),
  theme: z.string().optional(),
  scores: z.object({
    opening: score, entertainment: score, standalone: score, pacing: score, emotion: score,
    interest: score, avQuality: score, ending: score, retention: score,
  }),
});
const picksResponse = z.object({ clips: z.array(z.unknown()).default([]) });

const SELECT_SYSTEM = `You are an expert short-form video editor who selects the best standalone clips from a long video transcript for TikTok, Reels and Shorts.

You receive numbered sentences with timestamps. Choose complete, self-contained moments.

A clip MUST:
- start at the first sentence of a thought and end at a sentence that lands naturally (never mid-sentence, never mid-thought);
- open with something that grabs attention immediately; if it needs setup, start slightly EARLIER rather than dropping the context;
- make sense with no knowledge of the rest of the video, with one clear central idea and a satisfying ending;
- be roughly {MIN}-{MAX} seconds long.

Avoid: random cuts, clips with no clear point, dependence on missing context, near-duplicates of each other, splitting one good moment into several weak clips, long dead air.
Quality beats quantity: return only moments you would genuinely post. Returning zero clips for a window is fine.

Look for: funny moments, surprising statements, strong opinions, clear educational explanations, emotional/inspirational moments, stories, sharp Q&A, debates, twists, revelations, memorable quotes.

HOOKS: write a short on-screen hook (max 12 words) that is TRUE to the clip. Never invent claims, never misrepresent the speaker, no misleading clickbait. The hook is a label, not a quote. For every hook also return "hookGrounding": an exact, verbatim 3+ word phrase copied from the clip's sentences that supports the hook.

SCORES: rate each 0-10 honestly (opening, entertainment, standalone, pacing, emotion, interest, avQuality, ending, retention). Most clips should NOT score 9-10.

category must be one of: funny, surprising, educational, inspirational, story, debate, opinion, qa, quote, visual.
theme (subtitle style recommendation) must be one of: bold, creator, minimal, karaoke, documentary, energetic, cinematic. Podcasts/stories -> bold, educational -> minimal, entertainment -> energetic, serious -> documentary, motivational -> creator, quotes -> cinematic.

Respond with JSON only:
{"clips":[{"startSentence":int,"endSentence":int,"title":str,"description":str,"hook":str,"hookGrounding":str,"category":str,"theme":str,"scores":{"opening":n,"entertainment":n,"standalone":n,"pacing":n,"emotion":n,"interest":n,"avQuality":n,"ending":n,"retention":n}}]}`;

const REFINE_SYSTEM = `You refine ONE existing short-form clip based on a user instruction. Use only the sentences provided. Preserve the original meaning; never invent content or alter what was said.
You may change the clip's sentence range, title, hook and subtitle theme. Keep the clip self-contained, starting on a complete thought and ending naturally, within {MIN}-{MAX} seconds.
Hooks are TRUE labels (max 12 words), and must include "hookGrounding": a verbatim 3+ word phrase from the clip's sentences.
Respond with JSON only (omit fields you are not changing):
{"startSentence":int,"endSentence":int,"title":str,"hook":str,"hookGrounding":str,"theme":"bold|creator|minimal|karaoke|documentary|energetic|cinematic"}`;

function fill(t: string, o: AnalyzeOptions) {
  return t.replace("{MIN}", String(o.minSeconds)).replace("{MAX}", String(o.maxSeconds));
}

function lines(sentences: Sentence[]) {
  return sentences.map((s) => `[${s.index}] (${fmtTime(s.start)}${s.speaker ? ` ${s.speaker}` : ""}) ${s.text}`).join("\n");
}

export class OpenAILlm implements LlmProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new ProviderNotConfiguredError("OpenAI LLM", ["OPENAI_API_KEY"]);
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  private async completeJson(system: string, user: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.client.chat.completions.create({
        model: env.OPENAI_LLM_MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      try {
        return JSON.parse(res.choices[0]?.message?.content ?? "{}");
      } catch (e) {
        if (attempt >= 1) throw new Error("The model returned invalid JSON twice");
      }
    }
  }

  /** One-paragraph gist of the whole video, from text sampled evenly across it, used as context for each window. */
  private async summarize(sentences: Sentence[]): Promise<string> {
    const budgetWords = 5000;
    const totalWords = sentences.reduce((n, s) => n + s.text.split(" ").length, 0);
    const keepEvery = Math.max(1, Math.ceil(totalWords / budgetWords));
    const sample = sentences.filter((_, i) => i % keepEvery === 0).map((s) => s.text).join(" ");
    const res = await this.client.chat.completions.create({
      model: env.OPENAI_LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Summarise what this video is about in 3 sentences: topic, format (podcast, lecture, vlog...), speakers if evident. Plain text." },
        { role: "user", content: sample.slice(0, 40000) },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  async selectClips(transcript: Transcript, opts: AnalyzeOptions): Promise<ClipCandidate[]> {
    const sentences = buildSentences(transcript.words);
    if (!sentences.length) return [];
    const summary = await this.summarize(sentences);

    // Overlapping windows over the whole video, ~12 min each with 90 s overlap.
    const WINDOW = 720;
    const OVERLAP = 90;
    const windows: Sentence[][] = [];
    let i = 0;
    while (i < sentences.length) {
      const startT = sentences[i].start;
      let j = i;
      while (j < sentences.length && sentences[j].end - startT < WINDOW) j++;
      j = Math.max(j, i + 1);
      windows.push(sentences.slice(i, j));
      if (j >= sentences.length) break;
      let next = j;
      while (next > i + 1 && sentences[j - 1].end - sentences[next - 1].start < OVERLAP) next--;
      i = Math.max(next, i + 1);
    }

    const picks: RawPick[] = [];
    const system = fill(SELECT_SYSTEM, opts);
    const queue = [...windows];
    const worker = async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        const user = `VIDEO CONTEXT: ${summary}\n\nWINDOW (${fmtTime(w[0].start)}–${fmtTime(w[w.length - 1].end)} of ${fmtTime(opts.durationSeconds)}):\n${lines(w)}`;
        const raw = picksResponse.parse(await this.completeJson(system, user));
        for (const item of raw.clips) {
          const parsed = pickSchema.safeParse(item);
          if (parsed.success) picks.push(parsed.data);
        }
      }
    };
    await Promise.all([worker(), worker()]);

    return buildCandidates(picks, sentences, transcript.words, opts);
  }

  async refineClip(args: {
    transcript: Transcript;
    clip: { start: number; end: number; title: string; hook: string };
    instruction: string;
    opts: AnalyzeOptions;
  }) {
    const { transcript, clip, instruction, opts } = args;
    const sentences = buildSentences(transcript.words);
    const ctx = sentences.filter((s) => s.end > clip.start - 120 && s.start < clip.end + 120);
    const cur = ctx.filter((s) => s.start >= clip.start - 0.5 && s.end <= clip.end + 0.5);
    const user = `INSTRUCTION: ${instruction}\n\nCURRENT CLIP: sentences ${cur[0]?.index}–${cur[cur.length - 1]?.index}, title "${clip.title}", hook "${clip.hook}"\n\nSENTENCES (including surrounding context):\n${lines(ctx)}`;
    const raw = (await this.completeJson(fill(REFINE_SYSTEM, opts), user)) as Record<string, unknown>;

    const result: Partial<Pick<ClipCandidate, "start" | "end" | "title" | "hook" | "suggestedTheme">> = {};
    const hasRange = raw.startSentence != null && raw.endSentence != null;
    let clipText = cur.map((s) => s.text).join(" ");
    if (hasRange) {
      const snap = snapToSentences(Number(raw.startSentence), Number(raw.endSentence), sentences, opts.minSeconds, opts.maxSeconds, opts.durationSeconds);
      if (snap) {
        result.start = snap.start;
        result.end = snap.end;
        clipText = sentences.slice(snap.startSentence, snap.endSentence + 1).map((s) => s.text).join(" ");
      }
    }
    if (typeof raw.title === "string" && raw.title.trim()) result.title = raw.title.trim().slice(0, 100);
    if (typeof raw.hook === "string" && isHookGrounded(raw.hookGrounding as string | undefined, clipText)) {
      result.hook = raw.hook.trim().slice(0, 90);
    }
    if (typeof raw.theme === "string") result.suggestedTheme = toTheme(raw.theme, toCategory(undefined));
    return result;
  }
}
