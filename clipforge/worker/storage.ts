import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { admin, BUCKET } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

export async function downloadToFile(storagePath: string, dest: string): Promise<void> {
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (error || !data) throw new Error(`Could not access ${storagePath}: ${error?.message}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`Download of ${storagePath} failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
}

const SMALL = 100 * 1024 * 1024;

/** Upload a local file. Small files use the SDK; large ones are streamed to avoid loading them into memory. */
export async function uploadFile(storagePath: string, localPath: string, contentType: string): Promise<void> {
  const { size } = await fs.promises.stat(localPath);
  if (size <= SMALL) {
    const buf = await fs.promises.readFile(localPath);
    const { error } = await admin().storage.from(BUCKET).upload(storagePath, buf, { contentType, upsert: true });
    if (error) throw new Error(`Upload to ${storagePath} failed: ${error.message}`);
    return;
  }
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const init = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": contentType,
      "Content-Length": String(size),
      "x-upsert": "true",
    },
    body: Readable.toWeb(fs.createReadStream(localPath)),
    duplex: "half", // Node's fetch requires this for streamed request bodies
  };
  const res = await fetch(url, init as unknown as RequestInit);
  if (!res.ok) throw new Error(`Upload to ${storagePath} failed: HTTP ${res.status} ${await res.text()}`);
}

export async function removePaths(paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await admin().storage.from(BUCKET).remove(list);
}
