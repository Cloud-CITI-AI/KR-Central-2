/**
 * ADMIN_MFA_EVIDENCE=acrs (go-live gate G2): the sign-in must ask Entra for the authentication context, and an admin
 * whose ID token carries it passes the MFA gate. The mock IdP puts a user's `acrs` into the token whatever the request
 * says (Entra only does so when the app requested the context), so the request itself is asserted on the authorize URL.
 */
import type { MockIdp } from "@kr/mock-idp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, testConfig, type TestApp } from "../../../../test/helpers/index.js";
import { browserSignIn, cookieOf, mockUser, startIdpFor } from "../testing.js";

const withContext = mockUser(81, { amr: ["pwd"], acrs: ["c1"] });
const withoutContext = mockUser(82, { amr: ["pwd"], acrs: [] });
const otherContext = mockUser(83, { amr: ["pwd"], acrs: ["c2"] });
const ENV = { REQUIRE_MFA_FOR_ADMIN: "true", ADMIN_MFA_EVIDENCE: "acrs", ENTRA_ADMIN_AUTH_CONTEXT_ID: "c1" };

describe("acrs as admin MFA evidence (real Postgres, mock IdP)", () => {
  let idp: MockIdp;
  let t: TestApp;

  beforeAll(async () => {
    idp = await startIdpFor(testConfig(), [withContext, withoutContext, otherContext]);
    t = await createTestApp({ config: testConfig({ ...ENV, ENTRA_AUTHORITY_HOST: idp.authorityHost }) });
  });
  afterAll(async () => {
    await t.close();
    await idp.stop();
  });

  const adminList = async (u: { oid: string }) => {
    const trip = await browserSignIn(t.app, idp, { loginHint: u.oid });
    await t.db.updateTable("users").set({ role: "admin" }).where("entra_object_id", "=", u.oid).execute();
    const cookie = cookieOf(trip.callback, "__Host-kr_session");
    return t.app.inject({ url: "/v1/users", headers: { cookie: `__Host-kr_session=${cookie}` } });
  };

  it("asks for the authentication context with the authorize request", async () => {
    const trip = await browserSignIn(t.app, idp, { loginHint: withContext.oid });
    const claims = new URL(trip.start.headers.location!).searchParams.get("claims");
    expect(JSON.parse(claims ?? "null")).toEqual({ id_token: { acrs: { essential: true, value: "c1" } } });
  });

  it("does not ask for it when the evidence is amr", async () => {
    const amr = await createTestApp({
      config: testConfig({ REQUIRE_MFA_FOR_ADMIN: "true", ENTRA_AUTHORITY_HOST: idp.authorityHost }),
    });
    try {
      const res = await amr.app.inject({ url: "/v1/auth/login", headers: { "x-forwarded-for": "10.9.9.9" } });
      expect(new URL(res.headers.location!).searchParams.has("claims")).toBe(false);
    } finally {
      await amr.close();
    }
  });

  it("lets an admin whose token carries the context pass the MFA gate", async () => {
    expect((await adminList(withContext)).statusCode).toBe(200);
  });

  it("refuses an admin without it, or with another context", async () => {
    for (const u of [withoutContext, otherContext]) {
      const res = await adminList(u);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ detail: "Multi-factor sign-in required" });
    }
  });
});
