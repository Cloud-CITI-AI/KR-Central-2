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

  it("lets only admin and kr_admin link a job's Teams channel, and staff only see the panel (§2.1, ADR-0015)", () => {
    expect(jobCapabilitiesFor("admin", null)).toContain("teams.link");
    expect(jobCapabilitiesFor("kr_admin", null)).toContain("teams.link");
    expect(jobCapabilitiesFor("staff", null)).not.toContain("teams.link");
    expect(jobCapabilitiesFor("staff", null)).toContain("teams.view");
    for (const grant of ["client", "architect"] as const) {
      expect(jobCapabilitiesFor("external", grant)).not.toContain("teams.view");
      expect(jobCapabilitiesFor("external", grant)).not.toContain("teams.link");
    }
  });

  it("keeps Teams settings to admins, readable by kr_admin (§9.3)", () => {
    expect(globalCapabilitiesFor("admin")).toContain("teams.settings.manage");
    expect(globalCapabilitiesFor("kr_admin")).toContain("teams.settings.read");
    expect(globalCapabilitiesFor("kr_admin")).not.toContain("teams.settings.manage");
    expect(globalCapabilitiesFor("staff")).not.toContain("teams.settings.read");
    expect(globalCapabilitiesFor("external")).not.toContain("teams.settings.read");
  });
});
