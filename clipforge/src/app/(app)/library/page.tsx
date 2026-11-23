import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/storage";
import { fmtDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const sb = supabaseServer();
  const { data } = await sb
    .from("clips")
    .select("id,title,score,start_seconds,end_seconds,render_status,thumbnail_path,project_id,projects(title)")
    .eq("render_status", "ready")
    .order("created_at", { ascending: false })
    .limit(200);
  const clips = await Promise.all((data ?? []).map(async (c) => ({ ...c, thumb: await signedUrl(c.thumbnail_path) })));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Clip library</h1>
      <p className="mb-6 text-muted">Every finished clip across your projects.</p>
      {clips.length === 0 ? (
        <div className="card p-10 text-center text-muted">No finished clips yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {clips.map((c) => {
            const proj = (c.projects as unknown as { title: string } | null)?.title;
            return (
              <div key={c.id} className="card overflow-hidden">
                <Link href={`/clips/${c.id}`}>
                  <div className="aspect-[9/16] bg-surface">{c.thumb && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.thumb} alt="" className="h-full w-full object-cover" />}</div>
                </Link>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium">{c.title}</p>
                  <p className="mt-1 truncate text-xs text-muted">{proj} · {fmtDuration(Number(c.end_seconds) - Number(c.start_seconds))} · {Math.round(Number(c.score))}</p>
                  <div className="mt-2 flex gap-2 text-xs">
                    <a className="text-accent-soft hover:underline" href={`/api/clips/${c.id}/download`}>Download</a>
                    <Link className="text-muted hover:text-white" href={`/clips/${c.id}`}>Edit</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
