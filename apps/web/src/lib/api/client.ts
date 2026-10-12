import { buildPath, getRouteEntry, type RouteTableOperationId } from "@kr/contracts/routes-table";
import { navigation } from "@/lib/navigation";
import { safeReturnTo } from "@/lib/security/return-to";
import { getCsrfToken } from "./csrf";
import { persistDrafts } from "./drafts";
import { networkProblem, problemFromResponse } from "./problem";
import type { ApiArgs, ApiOperationId, ApiResult } from "./types";

/** All browser calls go through the same-origin BFF (ADR-0005): `/v1/...` on the API is `/api/v1/...` here. */
export const API_BASE = "/api";
/**
 * Responses are parsed with the contract schema in development and tests only. The schemas (and Zod) are loaded on demand
 * behind this flag, so a production build neither ships nor loads them: the browser needs only the schema-free route table.
 */
const validateResponses = process.env.NODE_ENV !== "production";

/** `/api` + the operation's path with its params filled in (also for the calls that do not go through `api()`). */
export function apiPath(operationId: RouteTableOperationId, params: Record<string, string> = {}): string {
  return `${API_BASE}${buildPath(getRouteEntry(operationId).path, params)}`;
}

interface RuntimeOptions {
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string | number | boolean | null | undefined>;
  readonly body?: unknown;
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

/**
 * `/sign-in?returnTo=<current same-origin path>`, with the `#fragment` of a deep link when it fits (§4: `#checkpoint-<key>`);
 * the sign-in pages themselves never loop.
 */
export function signInHref(pathname: string, search = "", hash = ""): string {
  const path = safeReturnTo(`${pathname}${search}`);
  const returnTo = path && path !== "/" ? (safeReturnTo(`${path}${hash}`) ?? path) : path;
  return returnTo && returnTo !== "/" && !returnTo.startsWith("/sign-in")
    ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
    : "/sign-in";
}

/**
 * A 401 means the session ended: go to sign-in and come back here afterwards (§3.1). Text typed into a field and not saved
 * yet is kept first (`persistDrafts`) and put back in the field after `returnTo`, so nothing the person wrote is lost (§15).
 */
export function redirectToSignIn(): void {
  persistDrafts();
  navigation.assign(signInHref(window.location.pathname, window.location.search, window.location.hash));
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
 * Typed call of one contract operation. Shapes come from the contract types; paths, methods and required headers from the
 * schema-free route table; problem+json becomes `ApiProblem`; 401 redirects to sign-in; in development and tests the
 * response is parsed with the contract schema.
 */
export async function api<Id extends ApiOperationId>(operationId: Id, ...args: ApiArgs<Id>): Promise<ApiResult<Id>> {
  const route = getRouteEntry(operationId);
  const { params, query, body, ifMatch, idempotencyKey, signal } = (args[0] ?? {}) as RuntimeOptions;
  // A header the route requires is a programming error when missing: say so here, not as a 400/428 from the API.
  if (route.ifMatch === "required" && ifMatch === undefined) throw new RangeError(`${operationId} needs ifMatch`);
  if (route.idempotencyKey === "required" && !idempotencyKey)
    throw new RangeError(`${operationId} needs idempotencyKey`);
  const headers = new Headers({ accept: "application/json" });
  if (route.csrf) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  if (ifMatch !== undefined) headers.set("if-match", `"${ifMatch}"`);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (body !== undefined) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiPath(operationId, params)}${buildQuery(query)}`, {
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
  if (!validateResponses) return json as ApiResult<Id>;
  const { parseResponse } = await import("./validate");
  return parseResponse(operationId, response.status, json) as ApiResult<Id>;
}
