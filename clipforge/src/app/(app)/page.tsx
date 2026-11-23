import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage";
import { UploadPanel } from "@/components/UploadPanel";
import { StatusBadge } from "@/components/StatusBadge";

export default async function DashboardPage() {
  const sb = supabaseServer();
  const { data: projects } = await sb.from("projects").select("id,title,status,created_at,thumbnail_path,duration_seconds").order("created_at", { ascending: false }).limit(6);
  const { count: clipCount } = await sb.from("clips").select("id", { count: "exact", head: true });
  const { count: projectCount } = await sb.from("projects").select("id", { count: "exact", head: true });
  const recent = await Promise.all((projects ?? []).map(async (p) => ({ ...p, thumb: await signedUrl(p.thumbnail_path) })));

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Turn long videos into clips people watch.</h1>
      <p className="mt-2 max-w-2xl text-muted">Upload a video or paste a link. ClipForge finds the best standalone moments, adds captions and reframes them for TikTok, Reels and Shorts.</p>

      <div className="mt-8"><UploadPanel /></div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="card p-4"><p className="text-xs uppercase tracking-wide text-muted">Projects</p><p className="mt-1 text-2xl font-semibold">{projectCount ?? 0}</p></div>
        <div className="card p-4"><p className="text-xs uppercase tracking-wide text-muted">Clips generated</p><p className="mt-1 text-2xl font-semibold">{clipCount ?? 0}</p></div>
      </div>

      {recent.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-medium">Recent projects</h2><Link href="/projects" className="text-sm text-accent-soft hover:underline">View all</Link></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recent.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card overflow-hidden transition hover:border-accent/60">
                <div className="aspect-video bg-surface">{p.thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="h-full w-full object-cover" />}</div>
                <div className="flex items-center justify-between gap-2 p-3"><p className="truncate text-sm font-medium">{p.title}</p><StatusBadge status={p.status} /></div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
