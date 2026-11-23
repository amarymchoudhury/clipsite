import { redirect } from "next/navigation";
import { configStatus } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { SetupBanner } from "@/components/SetupBanner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cfg = configStatus();
  if (!cfg.supabase.ok) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="mb-2 text-2xl font-semibold">Setup required</h1>
        <p className="mb-4 text-muted">ClipForge needs a Supabase project for sign-in, the database and file storage.</p>
        <p className="rounded-xl border border-border bg-card p-4 text-sm">
          Missing: <code>{cfg.supabase.missing.join(", ")}</code>. Copy <code>.env.example</code> to <code>.env.local</code>, fill in the values, run the SQL migrations, then restart. See the README for each step.
        </p>
      </main>
    );
  }
  const {
    data: { user },
  } = await supabaseServer().auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar email={user.email ?? ""} />
      <main className="min-w-0 flex-1 bg-[radial-gradient(70%_40%_at_60%_0%,#16122b,transparent)] p-6 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <SetupBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
