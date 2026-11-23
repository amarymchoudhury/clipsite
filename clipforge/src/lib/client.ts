"use client";
import { useEffect, useRef } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> | null) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(url: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new ApiError((body?.error as string) ?? `Request failed (${res.status})`, res.status, body);
  return body as T;
}

/** Calls fn immediately and then every `ms` while `enabled`. */
export function usePolling(fn: () => Promise<void> | void, ms: number, enabled: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      try {
        await ref.current();
      } catch {
        /* transient errors: keep polling */
      }
      if (!stop) timer = setTimeout(tick, ms);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ms, enabled]);
}

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}
