import { describe, expect, it } from "vitest";
import { authorizationClaims } from "./oidc.js";

const base = { REQUIRE_MFA_FOR_ADMIN: true, ADMIN_MFA_EVIDENCE: "acrs", ENTRA_ADMIN_AUTH_CONTEXT_ID: "c1" } as const;

describe("authorizationClaims", () => {
  it("requests the authentication context as an essential acrs ID token claim", () => {
    const claims = authorizationClaims(base);
    expect(claims).toBeDefined();
    expect(JSON.parse(claims ?? "")).toEqual({ id_token: { acrs: { essential: true, value: "c1" } } });
    expect(claims).toBe('{"id_token":{"acrs":{"essential":true,"value":"c1"}}}');
  });

  it("uses the configured context id", () => {
    expect(authorizationClaims({ ...base, ENTRA_ADMIN_AUTH_CONTEXT_ID: "c27" })).toContain('"value":"c27"');
  });

  it("requests nothing when the evidence is amr, MFA is not required, or no context is configured", () => {
    expect(authorizationClaims({ ...base, ADMIN_MFA_EVIDENCE: "amr" })).toBeUndefined();
    expect(authorizationClaims({ ...base, REQUIRE_MFA_FOR_ADMIN: false })).toBeUndefined();
    expect(authorizationClaims({ ...base, ENTRA_ADMIN_AUTH_CONTEXT_ID: undefined })).toBeUndefined();
  });
});
