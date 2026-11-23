export type PresetId = "default" | "tiktok" | "reels" | "facebook" | "shorts";

export interface ExportPreset {
  label: string;
  fps: number;
  crf: number;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  /** Platform's typical maximum length, used for UI warnings only. */
  recommendedMaxSeconds: number;
}

export const EXPORT_PRESETS: Record<PresetId, ExportPreset> = {
  default: { label: "High quality MP4", fps: 30, crf: 19, maxrate: "12M", bufsize: "24M", audioBitrate: "192k", recommendedMaxSeconds: 600 },
  tiktok: { label: "TikTok", fps: 30, crf: 21, maxrate: "10M", bufsize: "20M", audioBitrate: "160k", recommendedMaxSeconds: 600 },
  reels: { label: "Instagram Reels", fps: 30, crf: 21, maxrate: "8M", bufsize: "16M", audioBitrate: "128k", recommendedMaxSeconds: 90 },
  facebook: { label: "Facebook Reels", fps: 30, crf: 21, maxrate: "8M", bufsize: "16M", audioBitrate: "128k", recommendedMaxSeconds: 90 },
  shorts: { label: "YouTube Shorts", fps: 30, crf: 20, maxrate: "12M", bufsize: "24M", audioBitrate: "160k", recommendedMaxSeconds: 60 },
};

export const PRESET_IDS = Object.keys(EXPORT_PRESETS) as PresetId[];
