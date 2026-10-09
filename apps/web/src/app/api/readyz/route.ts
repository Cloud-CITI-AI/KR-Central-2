import { getEnv } from "@/env";
import { checkReadiness } from "@/lib/bff/readiness";

/** Web readiness: 200 `{status:"ok"}` when the API reports ready, otherwise 503 `{status:"degraded"}`. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let status: "ok" | "degraded" = "degraded";
  try {
    status = await checkReadiness({ apiUrl: getEnv().API_INTERNAL_URL });
  } catch {
    // Invalid configuration is "not ready"; the variable names surface at startup of the first page that needs them.
  }
  return Response.json({ status }, { status: status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
