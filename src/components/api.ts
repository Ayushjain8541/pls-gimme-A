"use client";
import { useState, useEffect, useCallback } from "react";
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const body = await res.json();
  if (!res.ok)
    throw new Error(body.error?.message || "Unable to complete this request.");
  return body as T;
}
export function useApi<T>(url: string | null, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setData(await api<T>(url));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void reload();
    if (poll) {
      const timer = setInterval(() => void reload(), poll);
      return () => clearInterval(timer);
    }
  }, [reload, poll]);
  return { data, error, reload, setData };
}
export function post<T>(url: string, body: unknown = {}) {
  return api<T>(url, { method: "POST", body: JSON.stringify(body) });
}
