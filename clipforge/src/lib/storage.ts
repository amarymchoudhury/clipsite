import { admin, BUCKET } from "@/lib/supabase/admin";

/** Short-lived signed URL for a private object. `download` sets the Content-Disposition filename. */
export async function signedUrl(path: string | null | undefined, opts: { ttl?: number; download?: string } = {}): Promise<string | null> {
  if (!path) return null;
  const { data } = await admin().storage.from(BUCKET).createSignedUrl(path, opts.ttl ?? 3600, opts.download ? { download: opts.download } : undefined);
  return data?.signedUrl ?? null;
}

/** Recursively delete everything under a storage prefix. */
export async function removePrefix(prefix: string): Promise<void> {
  const store = admin().storage.from(BUCKET);
  const files: string[] = [];
  const walk = async (dir: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data } = await store.list(dir, { limit: 100, offset });
      if (!data?.length) break;
      for (const e of data) {
        if (e.id) files.push(`${dir}/${e.name}`);
        else await walk(`${dir}/${e.name}`);
      }
      if (data.length < 100) break;
    }
  };
  await walk(prefix.replace(/\/$/, ""));
  for (let i = 0; i < files.length; i += 100) await store.remove(files.slice(i, i + 100));
}

export async function objectSize(path: string): Promise<number | null> {
  const i = path.lastIndexOf("/");
  const { data } = await admin().storage.from(BUCKET).list(path.slice(0, i), { search: path.slice(i + 1), limit: 5 });
  const hit = data?.find((o) => o.name === path.slice(i + 1));
  const size = (hit?.metadata as { size?: number } | undefined)?.size;
  return typeof size === "number" ? size : null;
}
