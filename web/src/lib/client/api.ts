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
