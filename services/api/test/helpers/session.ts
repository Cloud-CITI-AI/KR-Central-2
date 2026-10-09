/** Sign a user in without an identity provider: create the session row directly and return what a browser would hold. */
import type { UserRow } from "@kr/db";
import { createSession, sessionPolicy, SESSION_COOKIE } from "../../src/platform/session.js";
import type { TestApp } from "./app.js";

export interface SignedIn {
  /** `Cookie` header value. */
  readonly cookie: string;
  readonly cookieValue: string;
  readonly csrf: string;
  readonly user: UserRow;
}

export interface SignInOptions {
  readonly amr?: readonly string[];
  readonly acrs?: readonly string[];
}

export async function signIn(t: Pick<TestApp, "db" | "deps">, user: UserRow, o: SignInOptions = {}): Promise<SignedIn> {
  const s = await createSession(
    t.db,
    { userId: user.id, authTime: t.deps.clock.now(), amr: o.amr ?? ["pwd"], acrs: o.acrs ?? [] },
    sessionPolicy(t.deps),
  );
  return { cookie: `${SESSION_COOKIE}=${s.cookieValue}`, cookieValue: s.cookieValue, csrf: s.csrfToken, user };
}
