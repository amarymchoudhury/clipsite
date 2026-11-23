import type { Cue } from "./cues";
import type { SubtitleStyle } from "./themes";

export const VIDEO_W = 1080;
export const VIDEO_H = 1920;

/** #RRGGBB (+ opacity 0..1) → ASS &HAABBGGRR (alpha 00 = opaque). */
export function assColor(hex: string, opacity = 1): string {
  const h = hex.replace("#", "").padEnd(6, "0");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  const a = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255).toString(16).padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export function escapeAss(t: string): string {
  return t.replace(/\\/g, "").replace(/[{}]/g, "").replace(/\r?\n/g, " ");
}

// Safe zones for 1080x1920 (platform UI covers ~ the bottom 480px and top 220px).
const MARGIN_BOTTOM = 520;
const MARGIN_TOP = 420;

function styleLine(name: string, s: SubtitleStyle, align: number, marginV: number, boxed: boolean): string {
  const boxColor = assColor(s.background ?? "#000000", s.backgroundOpacity || 0.55);
  const outlineColour = boxed ? boxColor : assColor(s.outline);
  const back = assColor("#000000", 0.6);
  const borderStyle = boxed ? 3 : 1;
  const outline = boxed ? Math.max(s.outlineWidth, 12) : s.outlineWidth;
  // Primary = already-spoken/active colour, Secondary = upcoming colour (karaoke semantics).
  const primary = s.animation === "karaoke" ? assColor(s.highlight) : assColor(s.color);
  const secondary = assColor(s.color);
  return `Style: ${name},${s.font},${s.size},${primary},${secondary},${outlineColour},${back},${s.bold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},${s.shadow},${align},90,90,${marginV},1`;
}

function emphasise(tokens: string[], s: SubtitleStyle): string[] {
  if (!s.highlightKeywords) return tokens;
  // Highlight up to two "weighty" tokens per cue: numbers or the longest words.
  const scored = tokens
    .map((t, i) => ({ i, score: /\d/.test(t) ? 100 : t.replace(/[^\p{L}]/gu, "").length }))
    .filter((x) => x.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.i);
  const hl = assColor(s.highlight);
  const base = assColor(s.color);
  return tokens.map((t, i) => (scored.includes(i) ? `{\\c${hl}&}${t}{\\c${base}&}` : t));
}

function cueText(c: Cue, s: SubtitleStyle): string {
  const tf = (t: string) => escapeAss(s.uppercase ? t.toUpperCase() : t);
  if (s.animation === "karaoke" && c.words?.length) {
    // \k = switch colour exactly when each word starts
    const parts = c.words.map((w, i) => {
      const next = c.words![i + 1];
      const durCs = Math.max(1, Math.round(((next ? next.start : Math.max(w.end, c.end)) - w.start) * 100));
      return `{\\k${durCs}}${tf(w.word)}`;
    });
    const lead = Math.max(0, Math.round(c.words[0].start * 100) - Math.round(c.start * 100));
    return (lead > 0 ? `{\\k${lead}}` : "") + parts.join(" ");
  }
  const tokens = emphasise(tf(c.text).split(/\s+/), s);
  const pop = s.animation === "pop" ? "{\\fscx85\\fscy85\\t(0,110,\\fscx100\\fscy100)}" : "";
  return pop + tokens.join(" ");
}

export interface AssOptions {
  cues: Cue[];
  style: SubtitleStyle;
  /** Opening hook overlay, shown top-of-frame at the start. A label, not a quote. */
  hook?: string | null;
  durationSeconds: number;
  showSubtitles: boolean;
}

export function generateAss(o: AssOptions): string {
  const { style: s } = o;
  const align = s.position === "top" ? 8 : s.position === "middle" ? 5 : 2;
  const marginV = s.position === "bottom" ? MARGIN_BOTTOM : s.position === "top" ? MARGIN_TOP : 0;
  const boxed = !!s.background;

  const hookStyle: SubtitleStyle = { ...s, font: "DejaVu Sans", size: 64, bold: true, color: "#FFFFFF", highlight: "#FFFFFF", background: "#000000", backgroundOpacity: 0.6, outlineWidth: 18, animation: "none", uppercase: false, shadow: 0 };

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${VIDEO_W}`,
    `PlayResY: ${VIDEO_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styleLine("Sub", s, align, marginV, boxed),
    styleLine("Hook", hookStyle, 8, 230, true),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  if (o.showSubtitles) {
    for (const c of o.cues) {
      lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${cueText(c, s)}`);
    }
  }
  const hook = (o.hook ?? "").trim();
  if (hook) {
    const end = Math.min(3.5, Math.max(1.5, o.durationSeconds - 0.5));
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(end)},Hook,,0,0,0,,{\\fad(200,300)}${escapeAss(hook)}`);
  }
  return lines.join("\n") + "\n";
}
