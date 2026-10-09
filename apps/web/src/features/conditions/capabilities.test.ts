import { jobCapabilitiesFor } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { conditionPermissions } from "./capabilities";

describe("conditionPermissions", () => {
  it("lets staff edit, comment and upload evidence", () => {
    expect(conditionPermissions(jobCapabilitiesFor("staff", null))).toEqual({
      edit: true,
      comment: true,
      evidence: true,
    });
  });

  it.each(["client", "architect"] as const)("lets a %s comment and upload evidence but not edit", (grantRole) => {
    expect(conditionPermissions(jobCapabilitiesFor("external", grantRole))).toEqual({
      edit: false,
      comment: true,
      evidence: true,
    });
  });

  it("gives nothing to someone without access", () => {
    expect(conditionPermissions([])).toEqual({ edit: false, comment: false, evidence: false });
  });
});
