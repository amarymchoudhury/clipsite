import fs from "node:fs";
import OpenAI from "openai";
import { env } from "@/lib/env";
import type { Segment, Transcript, Word } from "@/lib/types";
import { ProviderNotConfiguredError, type TranscriptionProvider } from "./types";

interface VerboseResponse {
  language?: string;
  text: string;
  words?: { word: string; start: number; end: number }[];
  segments?: { text: string; start: number; end: number }[];
}

export class OpenAITranscription implements TranscriptionProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) throw new ProviderNotConfiguredError("OpenAI transcription", ["OPENAI_API_KEY"]);
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async transcribe(audioPath: string, opts?: { language?: string }): Promise<Transcript> {
    const res = (await this.client.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: env.OPENAI_TRANSCRIBE_MODEL,
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      ...(opts?.language ? { language: opts.language } : {}),
    })) as unknown as VerboseResponse;

    const words: Word[] = (res.words ?? []).map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }));
    const segments: Segment[] = (res.segments ?? []).map((s) => ({ text: s.text.trim(), start: s.start, end: s.end }));
    return { language: res.language ?? opts?.language ?? "unknown", text: res.text, words, segments };
  }
}
