import type { ManagedUser } from "@kr/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFactories, type Factories } from "../../../../test/factories.js";
import {
  apiRequest,
  createTestApp,
  signIn,
  testConfig,
  type SignedIn,
  type TestApp,
} from "../../../../test/helpers/index.js";

type Row = z.output<typeof ManagedUser>;
interface Page {
  items: Row[];
  nextCursor: string | null;
}

describe("listUsers (real Postgres)", () => {
  let t: TestApp;
  let f: Factories;
  let admin: SignedIn, krAdmin: SignedIn, staff: SignedIn;
  const as = async (role: "admin" | "kr_admin" | "staff" | "external") =>
    signIn(t, await f.makeUser({ role }), { amr: ["pwd", "mfa"] });
  const list = (who: SignedIn | undefined, query = "") =>
    apiRequest(t, { url: `/v1/users${query}`, ...(who ? { as: who } : {}) });

  beforeAll(async () => {
    t = await createTestApp({ config: testConfig({ REQUIRE_MFA_FOR_ADMIN: "true" }) });
    f = createFactories(t.db);
    [admin, krAdmin, staff] = [await as("admin"), await as("kr_admin"), await as("staff")];
  });
  afterAll(async () => {
    await t.close();
  });

  it("is admin only, and needs MFA evidence", async () => {
    for (const who of [krAdmin, staff, await as("external")]) expect((await list(who)).statusCode).toBe(403);
    expect((await list(undefined)).statusCode).toBe(401);
    const noMfa = await signIn(t, admin.user, { amr: ["pwd"] });
    const res = await list(noMfa);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: "Multi-factor sign-in required" });
    expect((await list(admin)).statusCode).toBe(200);
  });

  it("lists by name with search, role filter and a cursor; the email is shown to admins", async () => {
    const tag = `Zq${f.faker.string.alpha(6)}`;
    const made = [
      await f.makeUser({ role: "staff", displayName: `${tag} Charlie`, email: `${tag}.c@example.test` }),
      await f.makeUser({ role: "external", displayName: `${tag} Alpha`, email: `${tag}.a@example.test` }),
      await f.makeUser({ role: "staff", displayName: `${tag} Bravo`, email: null }),
    ];
    const names = async (query: string) => (await list(admin, query)).json<Page>().items.map((u) => u.displayName);
    expect(await names(`?q=${tag}`)).toEqual([`${tag} Alpha`, `${tag} Bravo`, `${tag} Charlie`]);
    expect(await names(`?q=${tag.toLowerCase()}.c@`)).toEqual([`${tag} Charlie`]);
    expect(await names(`?q=${tag}&role=staff`)).toEqual([`${tag} Bravo`, `${tag} Charlie`]);
    expect(await names("?q=%25")).toEqual([]);
    const first = (await list(admin, `?q=${tag}&limit=2`)).json<Page>();
    expect(first.items).toHaveLength(2);
    const second = (await list(admin, `?q=${tag}&limit=2&cursor=${first.nextCursor}`)).json<Page>();
    expect(second).toEqual({ items: [expect.objectContaining({ displayName: `${tag} Charlie` })], nextCursor: null });
    expect(first.items[0]).toMatchObject({
      id: made[1]?.id,
      email: `${tag}.a@example.test`,
      role: "external",
      isGuest: true,
      status: "active",
      lastSignInAt: null,
    });
    expect((await list(admin, "?cursor=bad")).statusCode).toBe(400);
  });
});
