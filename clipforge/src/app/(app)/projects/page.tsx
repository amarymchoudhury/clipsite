import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage";
import { StatusBadge } from "@/components/StatusBadge";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { fmtDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const sb = supabaseServer();
  const { data } = await sb.from("projects").select("*, clips(count)").order("created_at", { ascending: false });
  const projects = await Promise.all((data ?? []).map(async (p) => ({ ...p, thumb: await signedUrl(p.thumbnail_path) })));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My projects</h1>
        <Link href="/create" className="btn-primary">New project</Link>
      </div>
      {projects.length === 0 ? (
        <div className="card p-10 text-center text-muted">No projects yet. <Link href="/create" className="text-accent-soft hover:underline">Create your first clips</Link>.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="card overflow-hidden">
              <Link href={`/projects/${p.id}`}>
                <div className="aspect-video bg-surface">{p.thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.thumb} alt="" className="h-full w-full object-cover" />}</div>
              </Link>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2"><Link href={`/projects/${p.id}`} className="truncate font-medium hover:underline">{p.title}</Link><StatusBadge status={p.status} /></div>
                <p className="mt-1 text-xs text-muted">
                  {p.clips?.[0]?.count ?? 0} clips{p.duration_seconds ? ` · ${fmtDuration(Number(p.duration_seconds))}` : ""} · {new Date(p.created_at).toLocaleDateString()}
                </p>
                <div className="mt-3"><DeleteProjectButton id={p.id} title={p.title} /></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
