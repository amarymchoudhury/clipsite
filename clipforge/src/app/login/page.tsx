"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const sb = supabaseBrowser();
      if (mode === "in") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setMsg({ kind: "info", text: "Check your inbox to confirm your email, then sign in." });
        }
      }
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(60%_50%_at_50%_0%,#1b1536,transparent)] p-6">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
          <Clapperboard className="h-5 w-5 text-accent-soft" /> ClipForge
        </div>
        <h1 className="mb-1 text-xl font-semibold">{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <p className="mb-6 text-sm text-muted">Turn long videos into clips that are ready to post.</p>
        {!configured && (
          <p className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200">
            Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README).
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {msg && <p className={msg.kind === "error" ? "text-sm text-red-400" : "text-sm text-emerald-400"}>{msg.text}</p>}
          <button className="btn-primary w-full" disabled={busy || !configured}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
          </button>
        </form>
        <button className="mt-4 w-full text-center text-sm text-muted hover:text-white" onClick={() => setMode(mode === "in" ? "up" : "in")}>
          {mode === "in" ? "No account? Sign up" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
