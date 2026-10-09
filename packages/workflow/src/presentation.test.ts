import { describe, expect, it } from "vitest";
import {
  checkpointFolderName,
  compareJobNumbers,
  conditionEvidenceFolderName,
  jobDisplayText,
  safeName,
  stageFolderName,
  subdivisionTypeKey,
} from "./presentation.js";

describe("presentation helpers", () => {
  it("formats the job picker text", () => {
    expect(
      jobDisplayText({
        jobNumber: "S-0001",
        address: "1 Test Rd, Example",
        clientName: "Acme",
        subdivisionType: "Freehold",
      }),
    ).toBe("S-0001 – 1 Test Rd, Example – Acme (Freehold)");
    expect(jobDisplayText({ jobNumber: "", address: "1 Test Rd", clientName: null, subdivisionType: null })).toBe(
      "Job – 1 Test Rd",
    );
  });

  it("sorts job numbers naturally", () => {
    expect(["S-1000", "S-0420", "S-99"].sort(compareJobNumbers)).toEqual(["S-99", "S-0420", "S-1000"]);
  });

  it("normalises subdivision type keys", () => {
    expect(subdivisionTypeKey("Survey-Strata")).toBe("surveystrata");
    expect(subdivisionTypeKey(null)).toBe("");
  });

  it("makes names safe for zip paths", () => {
    expect(safeName('a/b:c*?"<>|d.')).toBe("a b c d");
    expect(safeName("")).toBe("file");
    expect(safeName("x".repeat(100))).toHaveLength(90);
  });

  it("lays out job file folders like the prototype", () => {
    expect(stageFolderName("wapc-approval")).toBe("02 WAPC Approval");
    expect(checkpointFolderName("wapc-approval", "4.3", "Queries from WAPC", true)).toBe(
      "02 WAPC Approval/4.3 Queries from WAPC/Query emails",
    );
    expect(conditionEvidenceFolderName("western-power", 12)).toBe(
      "03 Western Power/WAPC conditions/Condition 12 evidence",
    );
    expect(() => stageFolderName("nope")).toThrow(RangeError);
  });
});
