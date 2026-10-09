/** Web readiness: the API's /readyz, reduced to `{status}` (no internals leave the private network). */
export interface ReadinessOptions {
  readonly apiUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export async function checkReadiness({
  apiUrl,
  timeoutMs = 2000,
  fetchImpl = fetch,
}: ReadinessOptions): Promise<"ok" | "degraded"> {
  try {
    const res = await fetchImpl(`${apiUrl}/readyz`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      cache: "no-store",
    });
    await res.body?.cancel();
    return res.status === 200 ? "ok" : "degraded";
  } catch {
    return "degraded";
  }
}
