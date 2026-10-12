import { describe, expect, it } from "vitest";
import { LOCAL_USERS, localOptions } from "./config.js";
import { startMockIdp } from "./server.js";

describe("local mock IdP settings", () => {
  it("defaults to the fake values of .env.example on 127.0.0.1:4010 and accepts the web app's callback only", () => {
    const o = localOptions({});
    expect(o).toMatchObject({
      tenantId: "00000000-0000-4000-8000-000000000001",
      clientId: "00000000-0000-4000-8000-000000000002",
      clientSecret: "fake-client-secret-change-me",
      port: 4010,
      host: "127.0.0.1",
      publicUrl: "http://127.0.0.1:4010",
      redirectUris: ["http://localhost:3000/api/v1/auth/callback"],
      postLogoutRedirectUris: ["http://localhost:3000/signed-out"],
    });
  });

  it("takes tenant, client and secret from the same variables the API reads, and the rest from MOCK_IDP_*", () => {
    const o = localOptions({
      ENTRA_TENANT_ID: "t",
      ENTRA_CLIENT_ID: "c",
      ENTRA_CLIENT_SECRET: "s",
      PUBLIC_BASE_URL: "http://localhost:3999/",
      MOCK_IDP_PORT: "4555",
      MOCK_IDP_HOST: "0.0.0.0",
      MOCK_IDP_PUBLIC_URL: "http://mock-idp.localhost:4555/",
    });
    expect(o).toMatchObject({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
      port: 4555,
      host: "0.0.0.0",
      publicUrl: "http://mock-idp.localhost:4555",
      redirectUris: ["http://localhost:3999/api/v1/auth/callback"],
    });
  });

  it("treats empty variables as unset and refuses a bad port or a non-http public URL", () => {
    expect(localOptions({ MOCK_IDP_PORT: "", ENTRA_TENANT_ID: "" }).port).toBe(4010);
    for (const port of ["0", "70000", "abc", "40.5"])
      expect(() => localOptions({ MOCK_IDP_PORT: port })).toThrow(/port/);
    expect(() => localOptions({ MOCK_IDP_PUBLIC_URL: "https://idp.test" })).toThrow(/http/);
  });

  it("ships only synthetic people: a first admin with MFA, a staff member and two guests", () => {
    expect(LOCAL_USERS.map((u) => u.acct)).toEqual([0, 0, 1, 1]);
    expect(LOCAL_USERS[0]?.amr).toContain("mfa");
    expect(new Set(LOCAL_USERS.map((u) => u.oid)).size).toBe(LOCAL_USERS.length);
    for (const u of LOCAL_USERS) expect(u.email ?? "").toMatch(/@(krsurveys\.com\.au|example\.(com|net))$/);
  });

  it("serves discovery under the public URL, so API (compose network) and browser (host) share one authority", async () => {
    const o = localOptions({ MOCK_IDP_PORT: "4010", MOCK_IDP_PUBLIC_URL: "http://mock-idp.localhost:4010" });
    const idp = await startMockIdp({ ...o, port: 0, host: "127.0.0.1" });
    try {
      expect(idp.authorityHost).toBe("http://mock-idp.localhost:4010");
      expect(idp.issuer).toBe(`http://mock-idp.localhost:4010/${o.tenantId}/v2.0`);
    } finally {
      await idp.stop();
    }
  });
});
