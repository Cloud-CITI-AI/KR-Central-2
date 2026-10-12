import { describe, expect, it } from "vitest";
import {
  entryName,
  omitMissing,
  planPackage,
  zipFileName,
  type PackageCondition,
  type PackageFile,
} from "./package-layout.js";

const job = { jobNumber: "S-0001", address: "1 Example Street, Testville" };
const TOP = "S-0001 – 1 Example Street, Testville";
let seq = 0;
const file = (name: string, o: Partial<PackageFile> = {}): PackageFile => ({
  id: `f${++seq}`,
  name,
  kind: "pdf",
  contentType: "application/pdf",
  checkpointKey: null,
  conditionId: null,
  storageKey: `jobs/j/f${seq}`,
  uploadedAt: new Date("2026-03-02T01:00:00Z"),
  ...o,
});
const paths = (files: PackageFile[], conditions: PackageCondition[] = []) =>
  planPackage(job, files, conditions).entries.map((e) => e.path);

describe("planPackage", () => {
  it("names the zip after the job number and puts everything under '<job number> – <address>'", () => {
    const plan = planPackage(job, [], []);
    expect(plan.zipName).toBe("S-0001 – subdivision files.zip");
    expect(plan.summaryPath).toBe(`${TOP}/Job summary.txt`);
    expect(plan.entries).toEqual([]);
  });

  it("lays files out by stage folder and checkpoint folder, in workflow order", () => {
    expect(
      paths([
        file("Notice.pdf", { checkpointKey: "i13_notif" }),
        file("Survey.pdf", { checkpointKey: "i2_0" }),
        file("Letter.pdf", { checkpointKey: "i3_0p" }),
        file("Fee.pdf", { checkpointKey: "i1_0p" }),
      ]),
    ).toEqual([
      `${TOP}/01 Preliminaries/1.0 Fee proposal/Fee.pdf`,
      `${TOP}/01 Preliminaries/2.0 Site Feature Survey/Survey.pdf`,
      `${TOP}/02 WAPC Approval/3.0 WAPC Proposal/Letter.pdf`,
      `${TOP}/09 Landgate/12.2 Notification and Documents/Notice.pdf`,
    ]);
  });

  it("puts emails in '/Query emails' under 4.3", () => {
    expect(paths([file("Query.txt", { checkpointKey: "i4_3", kind: "email" })])).toEqual([
      `${TOP}/02 WAPC Approval/4.3 Queries from WAPC/Query emails/Query.txt`,
    ]);
  });

  it("gives text and email files with a dangerous extension a .txt name in the zip", () => {
    expect(
      paths([
        file("evil.vbe", { checkpointKey: "i13_notif", kind: "text" }),
        file("Invoice.pdf.exe", { checkpointKey: "i13_notif", kind: "text" }),
        file("shortcut.url", { checkpointKey: "i4_3", kind: "email" }),
      ]),
    ).toEqual([
      `${TOP}/02 WAPC Approval/4.3 Queries from WAPC/Query emails/shortcut.url.txt`,
      `${TOP}/09 Landgate/12.2 Notification and Documents/evil.vbe.txt`,
      `${TOP}/09 Landgate/12.2 Notification and Documents/Invoice.pdf.exe.txt`,
    ]);
  });

  it("serves a sniffed binary under an extension canonical for its kind, never one the recipient's machine runs", () => {
    expect(
      paths([
        file("report.exe", { checkpointKey: "i13_notif" }),
        file("invoice.pdf.lnk", { checkpointKey: "i13_notif" }),
        file("noext", { checkpointKey: "i13_notif" }),
        file("photo.scr", { checkpointKey: "i13_notif", kind: "image", contentType: "image/jpeg" }),
        file("clip.exe", { checkpointKey: "i13_notif", kind: "video", contentType: "video/webm" }),
        file("Plan.pdf", { checkpointKey: "i13_notif" }),
      ]),
    ).toEqual(
      ["report.exe.pdf", "invoice.pdf.lnk.pdf", "noext.pdf", "photo.scr.jpg", "clip.exe.webm", "Plan.pdf"].map(
        (n) => `${TOP}/09 Landgate/12.2 Notification and Documents/${n}`,
      ),
    );
  });

  it("puts condition evidence under the condition's agency stage, before that stage's checkpoints", () => {
    const conditions: PackageCondition[] = [
      { id: "c2", number: 2, agency: "Western Power" },
      { id: "c1", number: 1, agency: "WAPC" },
      { id: "c3", number: 12, agency: "Western Power" },
    ];
    expect(
      paths(
        [
          file("Clearance.pdf", { checkpointKey: "i6_9" }),
          file("b.jpg", { conditionId: "c3", kind: "image", contentType: "image/jpeg" }),
          file("a.jpg", { conditionId: "c2", kind: "image", contentType: "image/jpeg" }),
          file("w.pdf", { conditionId: "c1" }),
        ],
        conditions,
      ),
    ).toEqual([
      `${TOP}/03 Western Power/WAPC conditions/Condition 2 evidence/a.jpg`,
      `${TOP}/03 Western Power/WAPC conditions/Condition 12 evidence/b.jpg`,
      `${TOP}/03 Western Power/6.8 Western Power clearance received/Clearance.pdf`,
      `${TOP}/07 WAPC/WAPC conditions/Condition 1 evidence/w.pdf`,
    ]);
  });

  it("suffixes duplicate names with ' (2)', ' (3)' before the extension, ignoring case, and never collides", () => {
    expect(
      paths([
        file("Plan.pdf", { checkpointKey: "i2_0" }),
        file("plan.PDF", { checkpointKey: "i2_0" }),
        file("Plan.pdf", { checkpointKey: "i2_0" }),
        file("Notes.txt", { checkpointKey: "i2_0", kind: "text", contentType: "text/plain" }),
        file("notes.txt", { checkpointKey: "i2_0", kind: "text", contentType: "text/plain" }),
        file("Plan (2).pdf", { checkpointKey: "i2_0" }),
      ]).map((p) => p.split("/").pop()),
    ).toEqual(["Plan.pdf", "plan (2).PDF", "Plan (3).pdf", "Notes.txt", "notes (2).txt", "Plan (2) (2).pdf"]);
  });

  it("cleans names of path characters and keeps the extension of long names", () => {
    expect(entryName('a/b:c*"d".pdf')).toBe("a b c d.pdf");
    const long = entryName(`${"x".repeat(200)}.pdf`);
    expect(long).toHaveLength(94);
    expect(long.endsWith("xxx.pdf")).toBe(true);
    expect(entryName("...")).toBe("file");
  });
});

describe("zipFileName", () => {
  it("uses the job number only, made safe for a file name", () => {
    expect(zipFileName("S-0042")).toBe("S-0042 – subdivision files.zip");
    expect(zipFileName("A/B 1")).toBe("A B 1 – subdivision files.zip");
  });
});

describe("omitMissing", () => {
  const present = file("Survey.pdf", { checkpointKey: "i2_0" });
  const gone = file("Letter.pdf", { checkpointKey: "i3_0p" });
  const plan = planPackage(job, [present, gone], []);

  it("keeps the files whose object exists and names the others by their zip path without the top folder", () => {
    const result = omitMissing(plan, new Set([present.storageKey]));
    expect(result.plan.entries.map((e) => e.file.id)).toEqual([present.id]);
    expect(result.plan.zipName).toBe(plan.zipName);
    expect(result.plan.summaryPath).toBe(plan.summaryPath);
    expect(result.missing).toEqual(["02 WAPC Approval/3.0 WAPC Proposal/Letter.pdf"]);
  });

  it("changes nothing when every object exists", () => {
    const all = new Set([present.storageKey, gone.storageKey]);
    expect(omitMissing(plan, all)).toEqual({ plan, missing: [] });
  });
});
