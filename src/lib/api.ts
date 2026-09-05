"use client";

/** Client-side mutation helper: JSON in/out, readable errors. */
export async function apiSend<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      violations?: string[];
      issues?: string[];
    } | null;
    const detail = data?.violations?.[0] ?? data?.issues?.[0] ?? data?.error;
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
