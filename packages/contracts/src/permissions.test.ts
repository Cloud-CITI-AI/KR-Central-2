import { describe, expect, it } from "vitest";
import { globalCapabilitiesFor, hasCapability, jobCapabilitiesFor } from "./permissions.js";

describe("permissions", () => {
  it("gives user management to admins only", () => {
    expect(globalCapabilitiesFor("admin")).toContain("users.manage");
    for (const r of ["kr_admin", "staff", "external"] as const)
      expect(globalCapabilitiesFor(r)).not.toContain("users.manage");
    expect(globalCapabilitiesFor("external")).toEqual([]);
  });

  it("shows fee proposals to admin, kr_admin and the job's clients, but not to staff or architects", () => {
    expect(jobCapabilitiesFor("admin", null)).toContain("fee_proposal.view");
    expect(jobCapabilitiesFor("kr_admin", null)).toContain("fee_proposal.view");
    expect(jobCapabilitiesFor("external", "client")).toContain("fee_proposal.view");
    expect(jobCapabilitiesFor("staff", null)).not.toContain("fee_proposal.view");
    expect(jobCapabilitiesFor("external", "architect")).not.toContain("fee_proposal.view");
  });

  it("denies externals without a grant", () => {
    expect(jobCapabilitiesFor("external", null)).toEqual([]);
  });

  it("lets clients decide and pay but not change status", () => {
    const c = jobCapabilitiesFor("external", "client");
    expect(hasCapability(c, "checkpoint.decision.record")).toBe(true);
    expect(hasCapability(c, "checkpoint.paid.record")).toBe(true);
    expect(hasCapability(c, "checkpoint.status.edit")).toBe(false);
    expect(hasCapability(c, "access.manage")).toBe(false);
  });

  it("reserves job deletion and audit for admin roles", () => {
    expect(jobCapabilitiesFor("staff", null)).not.toContain("job.delete");
    expect(jobCapabilitiesFor("kr_admin", null)).toContain("job.delete");
  });
});
