import clsx from "clsx";

const STYLES: Record<string, string> = {
  ready: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300",
  processing: "border-violet-900/60 bg-violet-950/40 text-violet-300",
  queued: "border-violet-900/60 bg-violet-950/40 text-violet-300",
  uploading: "border-sky-900/60 bg-sky-950/40 text-sky-300",
  failed: "border-red-900/60 bg-red-950/40 text-red-300",
  draft: "border-border bg-surface text-muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={clsx("rounded-full border px-2 py-0.5 text-xs capitalize", STYLES[status] ?? STYLES.draft)}>{status}</span>;
}
