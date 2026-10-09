import { buildPath, getRoute } from "@kr/contracts";
import { navigation } from "@/lib/navigation";
import { safeReturnTo } from "@/lib/security/return-to";
import { getCsrfToken } from "./csrf";
import { networkProblem, problemFromResponse } from "./problem";
import type { ApiArgs, ApiOperationId, ApiResult } from "./types";

/** All browser calls go through the same-origin BFF (ADR-0005): `/v1/...` on the API is `/api/v1/...` here. */
export const API_BASE = "/api";
const validateResponses = process.env.NODE_ENV !== "production";

interface RuntimeOptions {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string | number | boolean | null | undefined>;
  readonly body?: unknown;
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

/** `/sign-in?returnTo=<current same-origin path>`; the sign-in pages themselves never loop. */
export function signInHref(pathname: string, search = ""): string {
  const returnTo = safeReturnTo(`${pathname}${search}`);
  return returnTo && returnTo !== "/" && !returnTo.startsWith("/sign-in")
    ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    : "/sign-in";
}

/** A 401 means the session ended: go to sign-in and come back here afterwards (§3.1). */
export function redirectToSignIn(): void {
  navigation.assign(signInHref(window.location.pathname, window.location.search));
}

export function buildQuery(query: RuntimeOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Typed call of one contract operation. Shapes, paths and methods come from `ROUTES`; problem+json becomes
 * `ApiProblem`; 401 redirects to sign-in; in development and tests the response is parsed with the contract schema.
 */
export async function api<Id extends ApiOperationId>(operationId: Id, ...args: ApiArgs<Id>): Promise<ApiResult<Id>> {
  const route = getRoute(operationId);
  const { params, query, body, ifMatch, idempotencyKey, signal } = (args[0] ?? {}) as RuntimeOptions;
  const headers = new Headers({ accept: "application/json" });
  if (route.method !== "GET") {
    const csrf = getCsrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  if (ifMatch !== undefined) headers.set("if-match", `"${ifMatch}"`);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (body !== undefined) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${buildPath(route.path, params ?? {})}${buildQuery(query)}`, {
      method: route.method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
      signal: signal ?? null,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw networkProblem();
  }

  if (!response.ok) {
    const problem = await problemFromResponse(response);
    if (problem.status === 401) redirectToSignIn();
    throw problem;
  }
  if (response.status === 204) return undefined as ApiResult<Id>;
  const json: unknown = await response.json();
  const schema = (route.responses[response.status] ?? route.responses[200])?.schema;
  return (validateResponses && schema ? schema.parse(json) : json) as ApiResult<Id>;
}
