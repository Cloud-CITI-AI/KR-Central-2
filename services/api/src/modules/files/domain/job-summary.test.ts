import { CHECKPOINTS } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { buildJobSummary, type SummaryInput } from "./job-summary.js";

const NOW = new Date("2026-09-28T07:50:00Z");
const base: SummaryInput = {
  job: {
    jobNumber: "S-0001",
    address: "1 Example Street, Testville",
    clientName: "Sample Developments Pty Ltd",
    subdivisionType: "Survey-Strata",
    conformedDate: null,
    outcomeDate: null,
  },
  states: [],
  conditions: [],
  notes: [],
  now: NOW,
};
const lines = (input: SummaryInput) => buildJobSummary(input).split("\r\n");

describe("buildJobSummary", () => {
  it("starts with the job line and the Perth download time, and uses CRLF line ends", () => {
    const text = buildJobSummary(base);
    expect(text.split("\r\n").slice(0, 3)).toEqual([
      "S-0001 – 1 Example Street, Testville – Sample Developments Pty Ltd (Survey-Strata)",
      "Downloaded 28 Sep 2026, 3:50 pm",
      "",
    ]);
    expect(text).not.toMatch(/(?<!\r)\n/);
  });

  it("lists every stage and every checkpoint with its status", () => {
    const all = lines({
      ...base,
      states: [{ checkpointKey: "i2_0", status: "completed", responsibility: "kr" }],
    });
    expect(all).toContain("01 PRELIMINARIES");
    expect(all).toContain("  2.0   Completed      Site Feature Survey");
    expect(all).toContain("  1.0   Not completed  Fee proposal");
    expect(all.filter((l) => /^ {2}\d+\.\d /.test(l))).toHaveLength(CHECKPOINTS.length);
    expect(all.filter((l) => /^\d\d [A-Z]/.test(l))).toHaveLength(10);
  });

  it("shows the conformed and outcome dates only when there is a conformed date", () => {
    expect(buildJobSummary(base)).not.toContain("Conformed date");
    const withDates = lines({ ...base, job: { ...base.job, conformedDate: "2026-03-16", outcomeDate: "2026-06-14" } });
    expect(withDates.slice(3, 6)).toEqual([
      "Conformed date: Mon, 16 Mar 2026",
      "WAPC outcome date: Sun, 14 Jun 2026",
      "",
    ]);
    const noOutcome = lines({ ...base, job: { ...base.job, conformedDate: "2026-03-16" } });
    expect(noOutcome[4]).toBe("WAPC outcome date: –");
  });

  it("marks an agency stage with no conditions in the Decision Letter as not required, with its checkpoints too", () => {
    const text = lines({
      ...base,
      states: [{ checkpointKey: "i6_0", status: "completed", responsibility: "kr" }],
      conditions: [
        {
          number: 1,
          agency: "Water Corporation",
          agencyGuessed: false,
          text: "Connect to the sewer.",
          isCleared: false,
          krComment: "",
          clientComment: "",
        },
      ],
    });
    expect(text).toContain("03 WESTERN POWER  (not required – no conditions in the Decision Letter)");
    expect(text).toContain("  6.0   Not required   Western Power connection application");
    expect(text).toContain("04 WATER CORPORATION");
  });

  it("lists the conditions with their comments and the job notes oldest first with indented lines", () => {
    const text = lines({
      ...base,
      conditions: [
        {
          number: 1,
          agency: "WAPC",
          agencyGuessed: false,
          text: "Drainage to the satisfaction of the Shire.",
          isCleared: true,
          krComment: "Done on site",
          clientComment: "",
        },
        {
          number: 12,
          agency: "Water Corporation",
          agencyGuessed: true,
          text: "Water agreement.",
          isCleared: false,
          krComment: "",
          clientComment: "Will send by Friday",
        },
      ],
      notes: [
        { createdAt: new Date("2026-09-20T01:05:00Z"), audience: "all", body: "First note\nsecond line" },
        { createdAt: new Date("2026-09-21T10:00:00Z"), audience: "client", body: "For the client" },
      ],
    });
    const at = text.indexOf("WAPC CONDITIONS");
    expect(text.slice(at, at + 6)).toEqual([
      "WAPC CONDITIONS",
      "  1   Cleared  WAPC  –  Drainage to the satisfaction of the Shire.",
      "        KR comment: Done on site",
      "  12  Open     Water Corporation  –  Water agreement.",
      "        Client comment: Will send by Friday",
      "",
    ]);
    expect(text.slice(text.indexOf("JOB NOTES"))).toEqual([
      "JOB NOTES",
      "  20 Sep 2026, 9:05 am  (for all)",
      "    First note",
      "    second line",
      "  21 Sep 2026, 6:00 pm  (for client)",
      "    For the client",
    ]);
  });

  it("has no conditions or notes sections when there are none", () => {
    const text = buildJobSummary(base);
    expect(text).not.toContain("WAPC CONDITIONS");
    expect(text).not.toContain("JOB NOTES");
  });

  it("lists files whose stored object is missing, right after the download line", () => {
    const text = lines({
      ...base,
      missingFiles: ["01 Preliminaries/2.0 Site Feature Survey/Survey.pdf", "Plan.pdf"],
    });
    expect(text.slice(0, 9)).toEqual([
      "S-0001 – 1 Example Street, Testville – Sample Developments Pty Ltd (Survey-Strata)",
      "Downloaded 28 Sep 2026, 3:50 pm",
      "",
      "FILES NOT INCLUDED (2)",
      "  These files could not be read from storage, so they are not in this zip. Ask KR Surveys to restore them.",
      "  01 Preliminaries/2.0 Site Feature Survey/Survey.pdf",
      "  Plan.pdf",
      "",
      "01 PRELIMINARIES",
    ]);
  });

  it("has no such section when nothing is missing", () => {
    expect(buildJobSummary({ ...base, missingFiles: [] })).not.toContain("FILES NOT INCLUDED");
  });
});
