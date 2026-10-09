/** PRODUCT_SPEC 3.1: admin and kr_admin sessions need MFA evidence for user management and the audit trail. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiRequest, signIn } from "../helpers/index.js";
import { createWorld, type World } from "./support.js";

const ADMIN_ROUTES = ["/v1/users", "/v1/audit-events"];
const DENIED = { type: "urn:kr:problem:forbidden", detail: "Multi-factor sign-in required" };

describe.each([
  ["amr", { ADMIN_MFA_EVIDENCE: "amr" }, ["pwd", "mfa"], [], 1],
  ["acrs", { ADMIN_MFA_EVIDENCE: "acrs", ENTRA_ADMIN_AUTH_CONTEXT_ID: "c1" }, ["pwd"], ["c1"], 2],
] as const)("MFA evidence by %s (REQUIRE_MFA_FOR_ADMIN=true)", (_name, config, amr, acrs, seed) => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld({ REQUIRE_MFA_FOR_ADMIN: "true", ...config }, seed);
  });
  afterAll(async () => {
    await w.t.close();
  });
  const session = async (role: "admin" | "kr_admin", evidence: { amr: readonly string[]; acrs: readonly string[] }) =>
    signIn(w.t, await w.f.makeUser({ role }), evidence);

  it.each(["admin", "kr_admin"] as const)(
    "%s without the evidence is refused on the admin routes, not elsewhere",
    async (role) => {
      const weak = await session(role, { amr: ["pwd"], acrs: ["c2"] });
      for (const url of ADMIN_ROUTES) {
        const res = await apiRequest(w.t, { url, as: weak });
        // kr_admin has no users.manage: it is refused for the capability before the evidence matters.
        expect(res.statusCode, `${role} ${url}`).toBe(403);
        if (role === "admin" || url === "/v1/audit-events") expect(res.json()).toMatchObject(DENIED);
      }
      expect((await apiRequest(w.t, { url: "/v1/jobs", as: weak })).statusCode).toBe(200);
    },
  );

  it("an admin with the evidence passes, and kr_admin passes on the audit trail", async () => {
    const admin = await session("admin", { amr, acrs });
    const kr = await session("kr_admin", { amr, acrs });
    for (const url of ADMIN_ROUTES) expect((await apiRequest(w.t, { url, as: admin })).statusCode, url).toBe(200);
    expect((await apiRequest(w.t, { url: "/v1/audit-events", as: kr })).statusCode).toBe(200);
  });

  it("the other claim does not count (amr cannot stand in for acrs, nor the reverse)", async () => {
    const wrong = await session(
      "admin",
      config.ADMIN_MFA_EVIDENCE === "amr" ? { amr: ["pwd"], acrs: ["c1"] } : { amr: ["pwd", "mfa"], acrs: [] },
    );
    expect((await apiRequest(w.t, { url: "/v1/users", as: wrong })).statusCode).toBe(403);
  });
});
