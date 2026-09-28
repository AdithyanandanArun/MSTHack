"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const any = e as { shortMessage?: string; message?: string; details?: string };
    if (any.shortMessage) return any.details ? `${any.shortMessage} (${any.details})` : any.shortMessage;
    if (any.message) return any.message.split("\n")[0];
  }
  return String(e);
}

export interface EvidenceRunStatus<R = unknown> {
  id: number;
  status: "queued" | "running" | "done" | "error";
  queuePosition: number | null;
  outcome: string | null;
  reportHash: string | null;
  error: string | null;
  report: R | null;
}

/** Polls a background evidence run until it finishes, reporting progress along the way. */
export async function waitForEvidence<R>(id: number, onProgress?: (s: EvidenceRunStatus<R>) => void, timeoutMs = 15 * 60_000): Promise<EvidenceRunStatus<R>> {
  const started = Date.now();
  for (;;) {
    const s = await api<EvidenceRunStatus<R>>(`/api/evidence/${id}`);
    onProgress?.(s);
    if (s.status === "done") return s;
    if (s.status === "error") throw new Error(`evidence run #${id} failed: ${s.error ?? "unknown error"}`);
    if (Date.now() - started > timeoutMs) throw new Error(`evidence run #${id} is still ${s.status}; check back later`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export function describeRunProgress(s: { status: string; queuePosition: number | null }): string {
  if (s.status === "queued") return s.queuePosition ? `Queued (position ${s.queuePosition})…` : "Queued…";
  if (s.status === "running") return "Running rules, sandbox and agent…";
  return s.status;
}
