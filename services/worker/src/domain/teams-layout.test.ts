import { STAGES } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import {
  layoutFolders,
  parentPaths,
  pathTooLong,
  remoteNameFor,
  sharePointSafe,
  targetFolderFor,
  uniqueName,
} from "./teams-layout.js";

describe("sharePointSafe", () => {
  it("removes forbidden characters, trailing dots and spaces, and reserved names", () => {
    expect(sharePointSafe('a:b*c?"d<e>f/g\\h|i')).toBe("a b c d e f g h i");
    expect(sharePointSafe("  trailing. ")).toBe("trailing");
    expect(sharePointSafe("name...")).toBe("name");
    expect(sharePointSafe("")).toBe("file");
    expect(sharePointSafe("Forms")).toBe("file");
    expect(sharePointSafe("_vti_bin")).toBe("vti_bin");
    expect(sharePointSafe("~$lock.docx")).toBe("$lock.docx");
    expect(sharePointSafe("tab\there")).toBe("tab here");
  });
  it("keeps the extension when shortening a long name", () => {
    const long = `${"x".repeat(300)}.pdf`;
    const out = sharePointSafe(long);
    expect(out).toHaveLength(255);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("layoutFolders", () => {
  const folders = layoutFolders();
  it("mirrors every stage and checkpoint folder of the zip except the fee proposal, parents first", () => {
    expect(folders[0]).toBe("01 Preliminaries");
    expect(folders.some((f) => f.includes("1.0 Fee proposal"))).toBe(false);
    expect(folders).toContain("02 WAPC Approval");
    expect(folders).toContain("02 WAPC Approval/4.3 Queries from WAPC");
    expect(folders).toContain("02 WAPC Approval/4.3 Queries from WAPC/Query emails");
    const checkpointCount = STAGES.flatMap((s) => s.checkpoints).filter((c) => c.restricted !== "fee_proposal").length;
    const emailFolders = folders.filter((f) => f.endsWith("/Query emails")).length;
    expect(folders).toHaveLength(STAGES.length + checkpointCount + emailFolders);
    for (const [i, path] of folders.entries()) {
      for (const parent of parentPaths(path)) expect(folders.indexOf(parent)).toBeLessThan(i);
    }
  });
  it("uses only SharePoint-safe segments", () => {
    for (const f of folders) for (const seg of f.split("/")) expect(sharePointSafe(seg)).toBe(seg);
  });
});

describe("targetFolderFor", () => {
  const conditions = [{ id: "c1", number: 12, agency: "Western Power" }];
  it("puts checkpoint files in their checkpoint folder, emails in Query emails, evidence under the agency stage", () => {
    expect(targetFolderFor({ checkpointKey: "i2_0", conditionId: null, kind: "pdf" }, [])).toBe(
      "01 Preliminaries/2.0 Site Feature Survey",
    );
    expect(targetFolderFor({ checkpointKey: "i4_3", conditionId: null, kind: "email" }, [])).toBe(
      "02 WAPC Approval/4.3 Queries from WAPC/Query emails",
    );
    expect(targetFolderFor({ checkpointKey: "i4_3", conditionId: null, kind: "pdf" }, [])).toBe(
      "02 WAPC Approval/4.3 Queries from WAPC",
    );
    expect(targetFolderFor({ checkpointKey: null, conditionId: "c1", kind: "image" }, conditions)).toBe(
      "03 Western Power/WAPC conditions/Condition 12 evidence",
    );
  });
  it("places nothing for the fee proposal, a superseded condition or an unknown checkpoint", () => {
    expect(targetFolderFor({ checkpointKey: "i1_0p", conditionId: null, kind: "pdf" }, [])).toBeNull();
    expect(targetFolderFor({ checkpointKey: null, conditionId: "gone", kind: "image" }, conditions)).toBeNull();
    expect(targetFolderFor({ checkpointKey: "nope", conditionId: null, kind: "pdf" }, [])).toBeNull();
    expect(targetFolderFor({ checkpointKey: null, conditionId: null, kind: "pdf" }, [])).toBeNull();
  });
});

describe("names", () => {
  it("serves a mis-named image under its sniffed extension and makes the stem safe", () => {
    expect(remoteNameFor("photo", "image", "image/jpeg")).toBe("photo.jpg");
    expect(remoteNameFor("plan: final?.pdf", "pdf", "application/pdf")).toBe("plan final.pdf");
  });
  it("suffixes duplicates like the zip, case-insensitively", () => {
    expect(uniqueName(["Plan.pdf"], "plan.pdf")).toBe("plan (2).pdf");
    expect(uniqueName(["plan.pdf", "plan (2).pdf"], "plan.pdf")).toBe("plan (3).pdf");
    expect(uniqueName(["notes"], "notes")).toBe("notes (2)");
    expect(uniqueName([], "plan.pdf")).toBe("plan.pdf");
  });
  it("lists parents shortest first and flags paths over the limit", () => {
    expect(parentPaths("a/b/c")).toEqual(["a", "a/b"]);
    expect(parentPaths("a")).toEqual([]);
    expect(pathTooLong("102. Subdivision Tracker", "02 WAPC Approval", "x.pdf")).toBe(false);
    expect(pathTooLong("102. Subdivision Tracker", "02 WAPC Approval", `${"x".repeat(400)}.pdf`)).toBe(true);
  });
});
