/**
 * Application (client-credentials) tokens for Microsoft Graph, for the worker's own Teams app registration
 * (ADR-0015 decision 2; the pattern of services/api graph-inviter.ts). The token is cached until 60 s before it
 * expires and dropped on a 401 so the next call fetches a fresh one. The secret and the token never reach logs or error
 * text: a failure carries the HTTP status and the identity provider's error code only.
 */
import type { Clock } from "../clock.js";

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
/** Fetched tokens are considered expired this long before Microsoft says so. */
const EXPIRY_MARGIN_MS = 60_000;

export class GraphTokenError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null, code: string | null, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GraphTokenError";
    this.status = status;
    this.code = code;
  }
}

export interface GraphTokenSourceOptions {
  readonly authorityHost: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clock: Clock;
  /** Test seam; defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

export interface GraphTokenSource {
  /** A bearer token, cached while valid. */
  token(signal: AbortSignal): Promise<string>;
  /** Forget the cached token (after a 401). */
  invalidate(): void;
}

const CODE = /^[\w.-]{1,80}$/;

/** The error code of an identity-provider or Graph error body, never its text (A6). */
export async function readErrorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    const e = body.error;
    const code = typeof e === "string" ? e : (e as { code?: unknown } | undefined)?.code;
    return typeof code === "string" && CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function createGraphTokenSource(o: GraphTokenSourceOptions): GraphTokenSource {
  const doFetch = o.fetch ?? fetch;
  const authority = o.authorityHost.replace(/\/+$/, "");
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function request(signal: AbortSignal): Promise<string> {
    let res: Response;
    try {
      res = await doFetch(`${authority}/${o.tenantId}/oauth2/v2.0/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: o.clientId,
          client_secret: o.clientSecret,
          scope: GRAPH_SCOPE,
          grant_type: "client_credentials",
        }),
        signal,
      });
    } catch (error) {
      throw new GraphTokenError("Microsoft sign-in could not be reached.", null, null, { cause: error });
    }
    if (!res.ok) {
      const code = await readErrorCode(res);
      throw new GraphTokenError(`Microsoft sign-in failed with ${res.status}.`, res.status, code);
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new GraphTokenError("Microsoft returned no access token.", res.status, null);
    }
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 300;
    cached = {
      token: body.access_token,
      expiresAt: o.clock.now().getTime() + Math.max(0, seconds * 1000 - EXPIRY_MARGIN_MS),
    };
    return body.access_token;
  }

  return {
    async token(signal) {
      if (cached && cached.expiresAt > o.clock.now().getTime()) return cached.token;
      // Concurrent callers share one token request instead of each hitting the identity provider.
      inFlight ??= request(signal).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate() {
      cached = null;
    },
  };
}
