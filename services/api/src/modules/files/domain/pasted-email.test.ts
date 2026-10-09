import { describe, expect, it } from "vitest";
import { PASTED_FROM, buildPastedEmail, formatPerthDateTime } from "./pasted-email.js";

describe("formatPerthDateTime", () => {
  it.each([
    ["2026-09-28T07:50:00Z", "28 Sep 2026, 3:50 pm"],
    ["2026-09-28T16:05:00Z", "29 Sep 2026, 12:05 am"],
    ["2026-09-28T04:00:00Z", "28 Sep 2026, 12:00 pm"],
    ["2026-12-31T15:59:59Z", "31 Dec 2026, 11:59 pm"],
  ])("%s is %s", (utc, expected) => {
    expect(formatPerthDateTime(new Date(utc))).toBe(expected);
  });
});

describe("buildPastedEmail", () => {
  const now = new Date("2026-09-28T07:50:00Z");

  it("takes the subject from the first line and names the file after it", () => {
    const email = buildPastedEmail("Query about lot 12\nPlease confirm the setback.\n", now);
    expect(email.subject).toBe("Query about lot 12");
    expect(email.fileName).toBe("Query about lot 12.txt");
    expect(email.content).toBe(
      [
        "Subject: Query about lot 12",
        `From: ${PASTED_FROM}`,
        "Date: 28 Sep 2026, 3:50 pm",
        "",
        "—".repeat(30),
        "",
        "Query about lot 12\nPlease confirm the setback.\n",
      ].join("\n"),
    );
  });

  it("cuts the subject at 90 characters and the file name at 80", () => {
    const email = buildPastedEmail(`${"a".repeat(200)}\nbody`, now);
    expect(email.subject).toHaveLength(90);
    expect(email.fileName).toBe(`${"a".repeat(80)}.txt`);
  });

  it("keeps file-name-unsafe characters out of the name but not out of the subject", () => {
    const email = buildPastedEmail('RE: plan/rev "B" <urgent>\r\nbody', now);
    expect(email.subject).toBe('RE: plan/rev "B" <urgent>');
    expect(email.fileName).toBe("RE plan rev B urgent.txt");
  });

  it("handles a first line of only punctuation", () => {
    expect(buildPastedEmail("...\nbody", now).fileName).toBe("file.txt");
  });
});
