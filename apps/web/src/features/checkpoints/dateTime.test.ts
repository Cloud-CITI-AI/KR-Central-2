import { describe, expect, it } from "vitest";
import { formatInstantDateTime } from "./dateTime";

describe("formatInstantDateTime", () => {
  it.each([
    ["2026-09-28T07:50:00.000Z", "28 Sep 2026, 3:50 pm"],
    ["2026-09-28T16:05:00.000Z", "29 Sep 2026, 12:05 am"],
    ["2026-09-28T04:00:00.000Z", "28 Sep 2026, 12:00 pm"],
    ["2026-01-01T02:09:59.000Z", "1 Jan 2026, 10:09 am"],
  ])("%s reads %s in Perth time", (iso, text) => {
    expect(formatInstantDateTime(iso)).toBe(text);
  });
});
