import { describe, expect, it } from "vitest";
import { readIdentity } from "./claims.js";
import { reasonForAuthorizeError, signInErrorPath } from "./reasons.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OID = "AAAAAAAA-0000-4000-8000-000000000001";
const base = { tid: TENANT, oid: OID, acct: 0, name: "Mia Member", email: "Mia@Staff.test", amr: ["pwd", "mfa"] };

describe("readIdentity", () => {
  it("reads a member's identity with lower-cased ids and email", () => {
    const r = readIdentity({ ...base, acrs: ["c1"], auth_time: 1_772_413_200 }, TENANT.toUpperCase());
    expect(r).toEqual({
      ok: true,
      identity: {
        tid: TENANT,
        oid: OID.toLowerCase(),
        displayName: "Mia Member",
        isGuest: false,
        email: "mia@staff.test",
        emailVerified: true,
        authTime: new Date("2026-03-02T01:00:00.000Z"),
        amr: ["pwd", "mfa"],
        acrs: ["c1"],
      },
    });
  });

  it("reads acct 1 (also as a string) as a guest and never takes the UPN as the email", () => {
    for (const acct of [1, "1"]) {
      const r = readIdentity({ ...base, acct, email: undefined, preferred_username: "g#EXT#@kr.test" }, TENANT);
      expect(r).toMatchObject({ ok: true, identity: { isGuest: true, email: null } });
    }
  });

  it.each([false, "false", 0, "0"])("treats xms_edov=%j as an unverified email", (xms_edov) => {
    expect(readIdentity({ ...base, xms_edov }, TENANT)).toMatchObject({ identity: { emailVerified: false } });
  });

  it.each([undefined, true, "true", 1])("treats xms_edov=%j as verified", (xms_edov) => {
    expect(readIdentity({ ...base, xms_edov }, TENANT)).toMatchObject({ identity: { emailVerified: true } });
  });

  it("rejects another tenant's token as wrong_tenant", () => {
    expect(readIdentity({ ...base, tid: "99999999-9999-4999-8999-999999999999" }, TENANT)).toEqual({
      ok: false,
      reason: "wrong_tenant",
    });
  });

  it.each([
    ["missing oid", { oid: undefined }],
    ["missing tid", { tid: undefined }],
    ["missing acct", { acct: undefined }],
    ["unknown acct", { acct: 2 }],
    ["non-guid oid", { oid: "not-a-guid" }],
  ])("fails closed on %s", (_name, override) => {
    expect(readIdentity({ ...base, ...override }, TENANT)).toEqual({ ok: false, reason: "failed" });
  });

  it("falls back for the display name and bounds it, amr and acrs", () => {
    expect(readIdentity({ ...base, name: "  " }, TENANT)).toMatchObject({
      identity: { displayName: "mia@staff.test" },
    });
    expect(readIdentity({ ...base, name: undefined, email: undefined }, TENANT)).toMatchObject({
      identity: { displayName: "Unknown user" },
    });
    const r = readIdentity(
      { ...base, name: "n".repeat(300), amr: Array.from({ length: 50 }, (_, i) => `m${i}`), acrs: 7 },
      TENANT,
    );
    expect(r).toMatchObject({ identity: { amr: expect.arrayContaining(["m0"]) as string[], acrs: [] } });
    if (r.ok) {
      expect(r.identity.displayName).toHaveLength(200);
      expect(r.identity.amr).toHaveLength(20);
    }
  });

  it("ignores a malformed auth_time", () => {
    expect(readIdentity({ ...base, auth_time: "yesterday" }, TENANT)).toMatchObject({ identity: { authTime: null } });
  });
});

describe("reasonForAuthorizeError", () => {
  it("maps a cancelled sign-in, wrong-directory AADSTS codes and everything else", () => {
    expect(reasonForAuthorizeError("access_denied", "AADSTS65004: user declined")).toBe("cancelled");
    expect(reasonForAuthorizeError("invalid_request", "AADSTS50020: User account does not exist in tenant")).toBe(
      "wrong_tenant",
    );
    expect(reasonForAuthorizeError("invalid_request", "AADSTS500200: other")).toBe("failed");
    expect(reasonForAuthorizeError("server_error")).toBe("failed");
  });

  it("builds the error page path", () => {
    expect(signInErrorPath("unverified_email")).toBe("/sign-in-error?reason=unverified_email");
  });
});
