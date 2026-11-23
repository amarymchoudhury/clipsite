import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { HttpError, SetupRequiredError } from "@/lib/errors";

export async function requireUser() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return { user, sb };
}

type Ctx = { params: Record<string, string> };

/** Wraps a route handler: JSON in, JSON out, consistent honest errors. */
export function route(fn: (req: NextRequest, ctx: Ctx) => Promise<Response | object>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
      if (e instanceof ZodError)
        return NextResponse.json({ error: "Invalid request", issues: e.issues }, { status: 400 });
      if (e instanceof SetupRequiredError)
        return NextResponse.json(
          { error: e.message, setupRequired: true, service: e.service, missing: e.missing },
          { status: 503 },
        );
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      const msg = e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === "string" ? (e as { message: string }).message : "Internal error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}

/** Load a project owned by the current user (RLS + explicit check) or 404. */
export async function ownedProject(id: string) {
  const { user, sb } = await requireUser();
  const { data, error } = await sb.from("projects").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Project not found");
  return { user, sb, project: data as ProjectRow };
}

export async function ownedClip(id: string) {
  const { user, sb } = await requireUser();
  const { data, error } = await sb.from("clips").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Clip not found");
  return { user, sb, clip: data as ClipRow };
}

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  source_type: "upload" | "url";
  source_url: string | null;
  storage_path: string | null;
  normalized_path: string | null;
  thumbnail_path: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  status: "draft" | "uploading" | "queued" | "processing" | "ready" | "failed";
  stage: string | null;
  progress: number;
  error: string | null;
  language: string | null;
  created_at: string;
}

export interface ClipRow {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  description: string | null;
  hook: string | null;
  category: string | null;
  start_seconds: number;
  end_seconds: number;
  score: number;
  score_breakdown: Record<string, number> | null;
  layout: "fill" | "speaker" | "blur" | "split";
  subtitle_theme: string;
  subtitles_enabled: boolean;
  subtitle_overrides: { start: number; end: number; text: string }[] | null;
  subtitle_style: Record<string, unknown> | null;
  crop: { x: number; auto?: boolean } | null;
  rev: number;
  original_volume: number;
  render_path: string | null;
  thumbnail_path: string | null;
  render_status: "pending" | "rendering" | "ready" | "failed";
  render_error: string | null;
  suggested_theme: string | null;
  history: unknown[];
  created_at: string;
}
