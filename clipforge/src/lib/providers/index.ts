import { env } from "@/lib/env";
import { OpenAITranscription } from "./openai-transcription";
import { OpenAILlm } from "./openai-llm";
import type { LlmProvider, TranscriptionProvider } from "./types";

/** Add new providers here (e.g. Deepgram, AssemblyAI, Anthropic) and select with the env vars. */
export function getTranscriber(): TranscriptionProvider {
  switch (env.TRANSCRIPTION_PROVIDER) {
    case "openai":
      return new OpenAITranscription();
    default:
      throw new Error(`Unknown TRANSCRIPTION_PROVIDER "${env.TRANSCRIPTION_PROVIDER}"`);
  }
}

export function getLlm(): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case "openai":
      return new OpenAILlm();
    default:
      throw new Error(`Unknown LLM_PROVIDER "${env.LLM_PROVIDER}"`);
  }
}
