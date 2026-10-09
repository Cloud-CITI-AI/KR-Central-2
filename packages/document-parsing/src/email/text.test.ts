import { describe, expect, it } from "vitest";
import type { ParsedEmail } from "../types.js";
import { emailToText } from "./text.js";

const email: ParsedEmail = {
  subject: "Lot 12 plan",
  from: "Sam Example <sam@example.test>",
  to: "a@example.test",
  cc: "b@example.test",
  date: "2026-03-16T01:30:00.000Z",
  body: "Hello,\nregards",
};

const RULE = "—".repeat(30);

describe("emailToText (the viewer rendering, PRODUCT_SPEC §10.3)", () => {
  it("renders Subject/From/To/Cc/Date, a rule and the body, with the date in Perth time", () => {
    expect(emailToText(email)).toBe(
      [
        "Subject: Lot 12 plan",
        "From: Sam Example <sam@example.test>",
        "To: a@example.test",
        "Cc: b@example.test",
        "Date: 16 Mar 2026, 9:30 am",
        "",
        RULE,
        "",
        "Hello,\nregards",
      ].join("\n"),
    );
  });

  it.each([
    ["2026-03-16T04:05:00.000Z", "16 Mar 2026, 12:05 pm"],
    ["2026-03-16T15:59:00.000Z", "16 Mar 2026, 11:59 pm"],
    ["2026-03-16T16:00:00.000Z", "17 Mar 2026, 12:00 am"],
    ["2026-12-31T20:00:00.000Z", "1 Jan 2027, 4:00 am"],
  ])("formats %s as %s", (iso, shown) => {
    expect(emailToText({ ...email, date: iso })).toContain(`Date: ${shown}\n`);
  });

  it("leaves out empty headers and says so when there is no subject or body", () => {
    expect(emailToText({ subject: "", from: "", to: "", cc: "", date: "", body: "" })).toBe(
      ["Subject: (no subject)", "", RULE, "", "(no message text)"].join("\n"),
    );
    expect(emailToText({ ...email, date: "not a date" })).not.toContain("Date:");
  });
});
