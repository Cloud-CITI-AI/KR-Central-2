/** Requests the way the web BFF sends them: session cookie, CSRF token and Origin on every state-changing call. */
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import type { SignedIn } from "./session.js";
import { TEST_ORIGIN } from "./config.js";
import type { TestApp } from "./app.js";

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly url: string;
  readonly as?: SignedIn;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** `null` omits the Origin header; undefined sends the configured public origin. */
  readonly origin?: string | null;
  /** `null` omits the CSRF header; undefined sends the session's own token. */
  readonly csrf?: string | null;
  /** Client address (X-Forwarded-For behind the BFF). */
  readonly forwardedFor?: string;
}

export function apiRequest(t: Pick<TestApp, "app">, o: ApiRequestOptions): Promise<LightMyRequestResponse> {
  const method = o.method ?? "GET";
  const unsafe = method !== "GET";
  const headers: Record<string, string> = { ...o.headers };
  if (o.as) headers.cookie = o.as.cookie;
  if (o.forwardedFor) headers["x-forwarded-for"] = o.forwardedFor;
  if (unsafe && o.origin !== null) headers.origin = o.origin ?? TEST_ORIGIN;
  if (unsafe && o.csrf !== null && o.as) headers["x-csrf-token"] = o.csrf ?? o.as.csrf;
  const inject: InjectOptions = {
    method,
    url: o.url,
    headers,
    ...(o.body === undefined ? {} : { payload: o.body as object }),
  };
  return t.app.inject(inject);
}
