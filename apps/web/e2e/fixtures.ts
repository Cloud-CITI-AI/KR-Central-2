import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import type { MockUser } from "@kr/mock-idp";
import { signInOverHttp, type ApiSession } from "./harness/api-client";
import { STACK_INFO_ENV } from "./harness/constants";
import { seedPeople } from "./harness/seed";
import { startStack, type Stack, type StackInfo } from "./harness/stack";
import type { UserKind } from "./harness/users";
import { newSyntheticUser } from "./harness/users";

/** What the journeys get: the running stack and helpers to be signed in as a synthetic person. */
export interface Fixtures {
  /** Sign `context` in as `user` (the real OIDC flow over HTTP, then the session cookie into the browser). */
  signInAs: (user: MockUser, target?: BrowserContext) => Promise<ApiSession>;
  /** An API client for `user` without touching the browser. */
  apiAs: (user: MockUser) => Promise<ApiSession>;
  /** A brand-new IdP user (for flows that change or revoke what a user can do). */
  newUser: (kind: UserKind, label: string, overrides?: Partial<MockUser>) => Promise<MockUser>;
}
export interface WorkerFixtures {
  stack: StackInfo;
}

function mainStack(): StackInfo {
  const raw = process.env[STACK_INFO_ENV];
  if (!raw) throw new Error(`${STACK_INFO_ENV} is not set: the stack starts in e2e/global-setup.ts`);
  return JSON.parse(raw) as StackInfo;
}

/** Sessions are reused within a worker: a session is valid for hours and sign-in is the slow step. */
const sessions = new Map<string, Promise<ApiSession>>();
function sessionFor(stack: StackInfo, user: MockUser): Promise<ApiSession> {
  const key = `${stack.webUrl}|${user.oid}`;
  let found = sessions.get(key);
  if (!found) {
    found = signInOverHttp(stack, user);
    sessions.set(key, found);
  }
  return found;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  stack: [
    async ({ playwright: _playwright }, provide) => {
      await provide(mainStack());
    },
    { scope: "worker" },
  ],
  apiAs: async ({ stack }, provide) => {
    await provide((user) => sessionFor(stack, user));
  },
  signInAs: async ({ stack, context }, provide) => {
    await provide(async (user, target = context) => {
      const session = await sessionFor(stack, user);
      await target.addCookies([session.sessionCookie()]);
      return session;
    });
  },
  newUser: async ({ stack }, provide) => {
    await provide(async (kind, label, overrides) => {
      const user = newSyntheticUser(kind, label, overrides);
      const response = await fetch(`${stack.controlUrl}/users`, { method: "POST", body: JSON.stringify(user) });
      if (!response.ok) throw new Error(`The harness refused the new user (${response.status.toString()})`);
      return user;
    });
  },
});

/**
 * A stack of its own (own database, S3 bucket, API, worker and web server) for journeys that need a pristine
 * system (the first sign-in) or different infrastructure (real malware scanning). One per worker: keep such journeys in
 * one file and run it serially. With `seed` the usual people exist first (the first KR member is admin, Sam is staff).
 */
export function isolatedStackTest(options: { label: string; malwareScanning?: "disabled" | "clamav"; seed?: boolean }) {
  return test.extend<{ own: Stack }, { ownStack: Stack }>({
    ownStack: [
      async ({ playwright: _playwright }, provide) => {
        const stack = await startStack({
          label: options.label,
          ...(options.malwareScanning ? { malwareScanning: options.malwareScanning } : {}),
        });
        try {
          if (options.seed) await seedPeople(stack.info);
          await provide(stack);
        } finally {
          await stack.stop();
        }
      },
      { scope: "worker", timeout: 300_000 },
    ],
    // Everything that signs in or opens a page talks to this stack instead of the main one.
    stack: [
      async ({ ownStack }, provide) => {
        await provide(ownStack.info);
      },
      { scope: "worker" },
    ],
    own: async ({ ownStack }, provide) => {
      await provide(ownStack);
    },
    baseURL: async ({ ownStack }, provide) => {
      await provide(ownStack.info.webUrl);
    },
    newUser: async ({ ownStack }, provide) => {
      await provide((kind, label, overrides) => Promise.resolve(addUserTo(ownStack, kind, label, overrides)));
    },
  });
}

function addUserTo(stack: Stack, kind: UserKind, label: string, overrides: Partial<MockUser> | undefined): MockUser {
  const user = newSyntheticUser(kind, label, overrides);
  stack.idp.addUser(user);
  return user;
}

export { expect };
export type { Page };
