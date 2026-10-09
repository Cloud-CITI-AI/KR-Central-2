/**
 * Shared set-up of the security suite (WP-20): one app with every limit raised (the suite sends thousands of requests
 * from a handful of users), the seven callers of PRODUCT_SPEC section 2.1 and a fresh job per scenario.
 * Synthetic data only (TD-1).
 */
import { buildPath, type Route } from "@kr/contracts";
import { createFactories, type Factories } from "../factories.js";
import { createTestApp, signIn, testConfig, type SignedIn, type TestApp } from "../helpers/index.js";

/** Limits high enough that no test in the suite is answered 429 (rate limiting has its own tests). */
export const NO_LIMITS = {
  RATE_LIMIT_SIGNIN_PER_MINUTE_PER_IP: "100000",
  RATE_LIMIT_WRITES_PER_MINUTE: "100000",
  RATE_LIMIT_UPLOADS_PER_MINUTE: "100000",
  RATE_LIMIT_READS_PER_MINUTE: "100000",
} as const;

export const ROLES = ["admin", "kr_admin", "staff", "client", "architect", "outsider", "disabled"] as const;
export type RoleName = (typeof ROLES)[number];
export type Actors = Readonly<Record<RoleName, SignedIn>>;

export interface World {
  readonly t: TestApp;
  readonly f: Factories;
  readonly actors: Actors;
  /** A new job on which `client` and `architect` hold active grants (`outsider` and `disabled` hold none). */
  freshJob(): ReturnType<Factories["makeJob"]>;
}

/** The callers of section 2.1. `disabled` signed in, then an admin disabled the account (its session must die). */
export async function createWorld(
  overrides: Readonly<Record<string, string>> = {},
  /** Factory seed: a file that builds two worlds must give them different seeds (users are unique per seed). */
  seed?: number,
): Promise<World> {
  const t = await createTestApp({ config: testConfig({ ...NO_LIMITS, ...overrides }) });
  const f = createFactories(t.db, seed);
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") =>
    signIn(t, await f.makeUser({ role }), { amr: ["pwd", "mfa"] });
  const disabled = await as("staff");
  await t.db.updateTable("users").set({ status: "disabled" }).where("id", "=", disabled.user.id).execute();
  const actors: Actors = {
    admin: await as("admin"),
    kr_admin: await as("kr_admin"),
    staff: await as("staff"),
    client: await as("external"),
    architect: await as("external"),
    outsider: await as("external"),
    disabled,
  };
  return {
    t,
    f,
    actors,
    async freshJob() {
      const job = await f.makeJob();
      await f.makeGrant({ jobId: job.id, userId: actors.client.user.id, role: "client" });
      await f.makeGrant({ jobId: job.id, userId: actors.architect.user.id, role: "architect" });
      return job;
    },
  };
}

const ID = "2f0f4a54-7f21-4d5c-9b63-0e2f5f9d1a77";

/** A concrete URL for a contract route; ids are well-formed but name nothing (authentication runs before lookups). */
export function urlFor(route: Pick<Route, "path">): string {
  const names = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");
  return buildPath(route.path, Object.fromEntries(names.map((n) => [n, n === "checkpointKey" ? "i2_0" : ID])));
}
