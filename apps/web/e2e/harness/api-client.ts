import { followAuthorize, type MockUser } from "@kr/mock-idp";
import type { StackInfo } from "./stack";

/** The cookie the API sets for a signed-in browser (`__Host-` prefix: Secure, Path=/, no Domain). */
export const SESSION_COOKIE = "__Host-kr_session";
const AUTH_COOKIE = "__Host-kr_auth";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${status.toString()} from ${path}: ${body.slice(0, 400)}`);
    this.name = "ApiError";
  }
}

function cookieValue(setCookies: readonly string[], name: string): string | undefined {
  for (const line of setCookies) {
    const [pair = ""] = line.split(";");
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq) === name && !line.includes("Max-Age=0")) return pair.slice(eq + 1);
  }
  return undefined;
}

/**
 * A signed-in API client that talks to the API port directly (the same session a browser gets through the web proxy).
 * Created by running the real OIDC code flow against the mock IdP, so the sign-in path under test is the production one.
 */
export class ApiSession {
  constructor(
    private readonly stack: Pick<StackInfo, "apiUrl" | "webUrl" | "idpUrl">,
    readonly user: MockUser,
    /** Value of the session cookie: give it to a browser context with `sessionCookie()`. */
    readonly sessionId: string,
    readonly csrfToken: string,
  ) {}

  /** The cookie to add to a Playwright context so the browser is signed in as this user. */
  sessionCookie(): {
    name: string;
    value: string;
    domain: string;
    path: "/";
    httpOnly: true;
    secure: true;
    sameSite: "Lax";
  } {
    // Host-only (no leading dot) and Secure: what the `__Host-` prefix demands; Chromium accepts it on http://localhost.
    return {
      name: SESSION_COOKIE,
      value: this.sessionId,
      domain: new URL(this.stack.webUrl).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      cookie: `${SESSION_COOKIE}=${this.sessionId}`,
      origin: this.stack.webUrl,
      "x-csrf-token": this.csrfToken,
      ...extra,
    };
  }

  async request(
    method: string,
    path: string,
    init: { body?: unknown; ifMatch?: string; form?: FormData } = {},
  ): Promise<Response> {
    const headers = this.headers({
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.ifMatch === undefined ? {} : { "if-match": init.ifMatch }),
      ...(method === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
    });
    return fetch(`${this.stack.apiUrl}${path}`, {
      method,
      headers,
      ...(init.form === undefined
        ? init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body) }
        : { body: init.form }),
      redirect: "manual",
    });
  }

  async json<T = unknown>(
    method: string,
    path: string,
    init: { body?: unknown; ifMatch?: string; form?: FormData } = {},
  ): Promise<T> {
    const response = await this.request(method, path, init);
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, `${method} ${path}`, text);
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.json<T>("GET", path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.json<T>("POST", path, { body });
  }
  patch<T = unknown>(path: string, body: unknown, ifMatch?: string): Promise<T> {
    return this.json<T>("PATCH", path, { body, ...(ifMatch === undefined ? {} : { ifMatch }) });
  }

  /** Upload one file into a checkpoint slot (or as condition evidence) the way the browser does. */
  upload(
    jobId: string,
    target: { checkpointKey: string; slot: string } | { conditionId: string },
    file: { name: string; bytes: Uint8Array; type: string },
  ): Promise<{ file: { id: string; scanStatus: string }; operation?: { id: string } | null }> {
    const form = new FormData();
    for (const [key, value] of Object.entries(target)) form.append(key, value);
    form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    return this.json("POST", `/v1/jobs/${jobId}/files`, { form });
  }
}

/** Run the OIDC authorization-code flow for `user` (the IdP signs in the `login_hint` user without a form). */
export async function signInOverHttp(
  stack: Pick<StackInfo, "apiUrl" | "webUrl" | "idpUrl">,
  user: MockUser,
): Promise<ApiSession> {
  const login = await fetch(`${stack.apiUrl}/v1/auth/login?returnTo=%2F`, { redirect: "manual" });
  const authorize = login.headers.get("location");
  const binding = cookieValue(login.headers.getSetCookie(), AUTH_COOKIE);
  if (login.status !== 302 || !authorize || !binding) {
    throw new ApiError(login.status, "GET /v1/auth/login", await login.text());
  }
  const callback = await followAuthorize(
    { authorityHost: stack.idpUrl },
    authorize,
    user.email ?? user.preferredUsername,
  );
  const done = await fetch(`${stack.apiUrl}/v1/auth/callback${callback.search}`, {
    redirect: "manual",
    headers: { cookie: `${AUTH_COOKIE}=${binding}` },
  });
  const location = done.headers.get("location") ?? "";
  const sessionId = cookieValue(done.headers.getSetCookie(), SESSION_COOKIE);
  if (done.status !== 302 || !sessionId) {
    throw new ApiError(done.status, "GET /v1/auth/callback", `sign-in refused: ${location}`);
  }
  const me = await fetch(`${stack.apiUrl}/v1/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${sessionId}`, accept: "application/json" },
  });
  if (!me.ok) throw new ApiError(me.status, "GET /v1/me", await me.text());
  const { csrfToken } = (await me.json()) as { csrfToken: string };
  return new ApiSession(stack, user, sessionId, csrfToken);
}
