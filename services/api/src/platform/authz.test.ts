import { describe, expect, it } from "vitest";
import type { GlobalRole } from "@kr/contracts";
import { globalCapabilitiesFor } from "@kr/contracts";
import { markAuthzChecked, type AuthContext } from "./auth-context.js";
import { assertMfaForAdmin, requireCapability, requireJobCapability, requireSignedIn } from "./authz.js";
import { ForbiddenError } from "./errors.js";

function auth(role: GlobalRole, session: { amr?: string[]; acrs?: string[] } = {}): AuthContext {
  return {
    user: {
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      displayName: "T",
      email: null,
      role,
      isGuest: role === "external",
    },
    session: {
      idHash: Buffer.alloc(32),
      csrfToken: "x".repeat(43),
      authTime: new Date(0),
      amr: session.amr ?? [],
      acrs: session.acrs ?? [],
      idleExpiresAt: new Date(0),
      absoluteExpiresAt: new Date(0),
    },
    globalCapabilities: globalCapabilitiesFor(role),
    authzChecked: false,
  };
}

const on = { REQUIRE_MFA_FOR_ADMIN: true, ADMIN_MFA_EVIDENCE: "amr", ENTRA_ADMIN_AUTH_CONTEXT_ID: undefined } as const;

describe("requireCapability / requireSignedIn", () => {
  it("allow a held capability and record that authorisation was decided", () => {
    const a = auth("admin");
    requireCapability(a, "users.manage");
    expect(a.authzChecked).toBe(true);
    const b = auth("external");
    requireSignedIn(b);
    expect(b.authzChecked).toBe(true);
  });
  it("deny a missing capability with 403 (and still record the decision)", () => {
    const a = auth("staff");
    expect(() => {
      requireCapability(a, "users.manage");
    }).toThrow(ForbiddenError);
    expect(a.authzChecked).toBe(true);
    expect(() => {
      requireCapability(auth("external"), "jobs.read_all");
    }).toThrow(ForbiddenError);
  });
  it("requireJobCapability checks the resolved capability list", () => {
    expect(() => {
      requireJobCapability({ capabilities: ["job.read"] }, "job.read");
    }).not.toThrow();
    expect(() => {
      requireJobCapability({ capabilities: ["job.read"] }, "job.edit");
    }).toThrow(ForbiddenError);
  });
  it("markAuthzChecked is what defineRoute reads", () => {
    const a = auth("staff");
    markAuthzChecked(a);
    expect(a.authzChecked).toBe(true);
  });
});

describe("assertMfaForAdmin", () => {
  it("amr mode: needs 'mfa' in amr for admin and kr_admin", () => {
    for (const role of ["admin", "kr_admin"] as const) {
      expect(() => {
        assertMfaForAdmin(auth(role, { amr: ["pwd", "mfa"] }), on);
      }).not.toThrow();
      expect(() => {
        assertMfaForAdmin(auth(role, { amr: ["pwd"] }), on);
      }).toThrow(/Multi-factor sign-in required/);
      expect(() => {
        assertMfaForAdmin(auth(role, { acrs: ["c1"] }), on);
      }).toThrow(ForbiddenError);
    }
  });
  it("acrs mode: needs the configured authentication context in acrs, amr alone is not enough", () => {
    const cfg = { ...on, ADMIN_MFA_EVIDENCE: "acrs", ENTRA_ADMIN_AUTH_CONTEXT_ID: "c3" } as const;
    expect(() => {
      assertMfaForAdmin(auth("admin", { acrs: ["c1", "c3"] }), cfg);
    }).not.toThrow();
    expect(() => {
      assertMfaForAdmin(auth("admin", { acrs: ["c1"] }), cfg);
    }).toThrow(ForbiddenError);
    expect(() => {
      assertMfaForAdmin(auth("admin", { amr: ["mfa"] }), cfg);
    }).toThrow(ForbiddenError);
  });
  it("acrs mode without a configured context denies (fail closed)", () => {
    expect(() => {
      assertMfaForAdmin(auth("admin", { acrs: ["c1"] }), { ...on, ADMIN_MFA_EVIDENCE: "acrs" });
    }).toThrow(ForbiddenError);
  });
  it("is off when REQUIRE_MFA_FOR_ADMIN is false and never applies to other roles", () => {
    expect(() => {
      assertMfaForAdmin(auth("admin"), { ...on, REQUIRE_MFA_FOR_ADMIN: false });
    }).not.toThrow();
    expect(() => {
      assertMfaForAdmin(auth("staff"), on);
    }).not.toThrow();
  });
  it("answers with the exact problem detail from the spec", () => {
    try {
      assertMfaForAdmin(auth("admin"), on);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({
        status: 403,
        detail: "Multi-factor sign-in required",
        type: "urn:kr:problem:forbidden",
      });
    }
  });
});
