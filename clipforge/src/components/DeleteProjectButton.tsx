"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/client";

export function DeleteProjectButton({ id, title, redirectTo }: { id: string; title: string; redirectTo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-danger px-3 py-1.5 text-xs"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Delete "${title}" and all of its clips and files? This can't be undone.`)) return;
        setBusy(true);
        try {
          await api(`/api/projects/${id}`, { method: "DELETE" });
          if (redirectTo) router.push(redirectTo);
          router.refresh();
        } catch (e) {
          alert(e instanceof Error ? e.message : "Delete failed");
          setBusy(false);
        }
      }}
    >
      <Trash2 className="h-3.5 w-3.5" /> {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
