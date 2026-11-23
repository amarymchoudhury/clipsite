import type { Transcript, ClipCandidate } from "@/lib/types";

/** Speech-to-text provider. Swap implementations via TRANSCRIPTION_PROVIDER. */
export interface TranscriptionProvider {
  readonly name: string;
  /** audioPath: local path to an audio file (<25MB for OpenAI; the worker chunks long audio). */
  transcribe(audioPath: string, opts?: { language?: string }): Promise<Transcript>;
}

export interface AnalyzeOptions {
  minSeconds: number;
  maxSeconds: number;
  durationSeconds: number;
}

/** LLM provider used for clip selection, hooks, scoring and clip refinement. */
export interface LlmProvider {
  readonly name: string;
  selectClips(transcript: Transcript, opts: AnalyzeOptions): Promise<ClipCandidate[]>;
  refineClip(args: {
    transcript: Transcript;
    clip: { start: number; end: number; title: string; hook: string };
    instruction: string;
    opts: AnalyzeOptions;
  }): Promise<Partial<Pick<ClipCandidate, "start" | "end" | "title" | "hook" | "suggestedTheme">>>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, missing: string[]) {
    super(`${provider} is not configured. Set: ${missing.join(", ")}`);
    this.name = "ProviderNotConfiguredError";
  }
}
