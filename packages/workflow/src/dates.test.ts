import { describe, expect, it } from "vitest";
import {
  addDays,
  addYears,
  approvalExpiryStatus,
  businessToday,
  daysUntilEndOfDay,
  formatDateWithWeekday,
  formatInstantShort,
  isIsoDate,
  outcomeCountdown,
  outcomeDateFor,
} from "./dates.js";

describe("dates", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-03-16")).toBe(true);
    expect(isIsoDate("2025-02-30")).toBe(false);
    expect(isIsoDate("28/07/2025")).toBe(false);
    expect(() => addDays("bad", 1)).toThrow(RangeError);
  });

  it("treats years below 100 as the year they say, not 19xx", () => {
    expect(isIsoDate("0001-01-01")).toBe(true);
    expect(isIsoDate("0050-06-15")).toBe(true);
    expect(isIsoDate("0001-02-29")).toBe(false);
    expect(isIsoDate("0000-02-29")).toBe(true); // year 0 is divisible by 400
    expect(isIsoDate("0100-02-29")).toBe(false); // year 100 is not a leap year
    expect(addDays("0001-01-01", 1)).toBe("0001-01-02");
    expect(addDays("0050-06-15", 1)).toBe("0050-06-16");
  });

  it("sets the outcome date 90 days after conformance", () => {
    expect(outcomeDateFor("2026-03-16")).toBe("2026-06-14");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addYears("2025-11-14", 3)).toBe("2028-11-14");
  });

  it("counts days to the end of a Perth business day", () => {
    const now = new Date("2026-01-10T15:59:00Z"); // 23:59 Perth on 10 Jan
    expect(businessToday(now)).toBe("2026-01-10");
    expect(daysUntilEndOfDay("2026-01-10", now)).toBe(1);
    expect(daysUntilEndOfDay("2026-01-09", now)).toBe(-1);
    expect(daysUntilEndOfDay("2026-01-08", now)).toBe(-2);
  });

  it("describes approval expiry", () => {
    const now = new Date("2026-01-10T02:00:00Z");
    expect(approvalExpiryStatus("2028-11-14", now)).toMatchObject({
      level: "ok",
      text: "1,040 days left to lodge Form 1C",
    });
    expect(approvalExpiryStatus("2026-01-10", now)).toMatchObject({
      level: "soon",
      text: "1 day left to lodge Form 1C",
    });
    expect(approvalExpiryStatus("2026-01-07", now)).toMatchObject({ level: "past", text: "Expired 3 days ago" });
    expect(approvalExpiryStatus("2026-01-09", now)).toMatchObject({ level: "past", text: "Expired 1 day ago" });
  });

  it("builds the outcome countdown", () => {
    const now = new Date("2026-06-08T04:00:00Z"); // 12:00 Perth
    expect(outcomeCountdown("2026-06-14", now)).toEqual({
      days: 6,
      hours: 11,
      minutes: 59,
      seconds: 59,
      state: "soon",
      caption: "until outcome date – Sun, 14 Jun 2026",
    });
    expect(outcomeCountdown("2026-05-20", now).state).toBe("past");
    expect(outcomeCountdown("2026-09-01", now).state).toBe("ok");
  });

  it("formats dates deterministically", () => {
    expect(formatDateWithWeekday("2026-06-14")).toBe("Sun, 14 Jun 2026");
    expect(formatInstantShort("2026-09-27T20:00:00Z")).toBe("28 Sep 2026");
  });
});
