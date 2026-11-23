import type { SubtitleThemeId } from "@/lib/types";

export type SubtitlePosition = "top" | "middle" | "bottom";
export type SubtitleAnimation = "none" | "pop" | "karaoke";

export interface SubtitleStyle {
  font: string;
  size: number; // px at 1080x1920
  bold: boolean;
  color: string; // #RRGGBB
  highlight: string; // #RRGGBB, active word / keyword colour
  outline: string; // #RRGGBB
  outlineWidth: number;
  shadow: number;
  background: string | null; // #RRGGBB box behind text, or null
  backgroundOpacity: number; // 0..1
  uppercase: boolean;
  position: SubtitlePosition;
  lineSpacing: number; // extra px between lines
  maxWordsPerCue: number;
  animation: SubtitleAnimation;
  emoji: boolean;
  highlightKeywords: boolean;
}

export const FONTS = ["DejaVu Sans", "Liberation Sans", "Liberation Serif", "Liberation Mono", "Noto Sans"] as const;

export const THEMES: Record<SubtitleThemeId, { label: string; description: string; style: SubtitleStyle }> = {
  bold: {
    label: "Bold",
    description: "Heavy white captions with a highlighted keyword. Great for podcasts and stories.",
    style: { font: "DejaVu Sans", size: 84, bold: true, color: "#FFFFFF", highlight: "#FFD60A", outline: "#000000", outlineWidth: 7, shadow: 2, background: null, backgroundOpacity: 0, uppercase: true, position: "bottom", lineSpacing: 6, maxWordsPerCue: 4, animation: "pop", emoji: false, highlightKeywords: true },
  },
  creator: {
    label: "Creator",
    description: "Punchy creator-style captions, one active word at a time.",
    style: { font: "DejaVu Sans", size: 88, bold: true, color: "#FFFFFF", highlight: "#2EF2A0", outline: "#000000", outlineWidth: 8, shadow: 0, background: null, backgroundOpacity: 0, uppercase: true, position: "middle", lineSpacing: 4, maxWordsPerCue: 3, animation: "karaoke", emoji: false, highlightKeywords: false },
  },
  minimal: {
    label: "Minimal",
    description: "Clean white text. Easy to read for educational content.",
    style: { font: "Liberation Sans", size: 64, bold: false, color: "#FFFFFF", highlight: "#FFFFFF", outline: "#000000", outlineWidth: 3, shadow: 1, background: null, backgroundOpacity: 0, uppercase: false, position: "bottom", lineSpacing: 4, maxWordsPerCue: 6, animation: "none", emoji: false, highlightKeywords: false },
  },
  karaoke: {
    label: "Word highlight",
    description: "Bold captions that light up word by word.",
    style: { font: "DejaVu Sans", size: 80, bold: true, color: "#FFFFFF", highlight: "#FF3B6B", outline: "#000000", outlineWidth: 7, shadow: 2, background: null, backgroundOpacity: 0, uppercase: true, position: "bottom", lineSpacing: 6, maxWordsPerCue: 4, animation: "karaoke", emoji: false, highlightKeywords: false },
  },
  documentary: {
    label: "Documentary",
    description: "Professional captions on a soft dark box.",
    style: { font: "Liberation Sans", size: 58, bold: false, color: "#FFFFFF", highlight: "#FFFFFF", outline: "#000000", outlineWidth: 14, shadow: 0, background: "#000000", backgroundOpacity: 0.55, uppercase: false, position: "bottom", lineSpacing: 6, maxWordsPerCue: 7, animation: "none", emoji: false, highlightKeywords: false },
  },
  energetic: {
    label: "Energetic",
    description: "Colourful, bouncy captions with emoji. For entertainment.",
    style: { font: "DejaVu Sans", size: 86, bold: true, color: "#FFFFFF", highlight: "#FF9F0A", outline: "#2B0A66", outlineWidth: 9, shadow: 3, background: null, backgroundOpacity: 0, uppercase: true, position: "middle", lineSpacing: 6, maxWordsPerCue: 3, animation: "pop", emoji: true, highlightKeywords: true },
  },
  cinematic: {
    label: "Cinematic",
    description: "Elegant serif captions for quotes and serious moments.",
    style: { font: "Liberation Serif", size: 66, bold: false, color: "#F4EBD9", highlight: "#F4EBD9", outline: "#000000", outlineWidth: 3, shadow: 2, background: null, backgroundOpacity: 0, uppercase: false, position: "bottom", lineSpacing: 6, maxWordsPerCue: 6, animation: "none", emoji: false, highlightKeywords: false },
  },
};

export function resolveStyle(theme: string, overrides?: Partial<SubtitleStyle> | null): SubtitleStyle {
  const base = (THEMES as Record<string, { style: SubtitleStyle }>)[theme]?.style ?? THEMES.bold.style;
  return { ...base, ...(overrides ?? {}) };
}
