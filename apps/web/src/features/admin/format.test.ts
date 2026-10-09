import { describe, expect, it } from "vitest";
import { formatPerthDateTime } from "./format";

describe("formatPerthDateTime", () => {
  it("shows Perth time (UTC+8) with am/pm", () => {
    expect(formatPerthDateTime("2026-09-28T03:50:56.543Z")).toBe("28 Sep 2026, 11:50 am");
    expect(formatPerthDateTime("2026-09-28T08:05:00.000Z")).toBe("28 Sep 2026, 4:05 pm");
  });

  it("rolls over midnight and shows 12 for midnight and noon", () => {
    expect(formatPerthDateTime("2026-12-31T16:00:00.000Z")).toBe("1 Jan 2027, 12:00 am");
    expect(formatPerthDateTime("2026-09-28T04:00:00.000Z")).toBe("28 Sep 2026, 12:00 pm");
  });
});
