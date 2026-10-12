import { describe, expect, it } from "vitest";
import { dateFromFileName, datesIn, isReadableDate, READABLE_DATE_MAX, READABLE_DATE_MIN } from "./dates.js";

describe("datesIn (PRODUCT_SPEC §10.1)", () => {
  it.each([
    ["16/03/2026", ["2026-03-16"]],
    ["16.03.2026", ["2026-03-16"]],
    ["16-03-2026", ["2026-03-16"]],
    ["6/3/26", ["2026-03-06"]],
    ["28 July 2025", ["2025-07-28"]],
    ["28th Jul, 2025", ["2025-07-28"]],
    ["1st Sept. 2025", ["2025-09-01"]],
    ["16-Mar-2026", ["2026-03-16"]],
    ["DATE 16-Mar-2026 FILE 123-26", ["2026-03-16"]],
    ["July 28, 2025", ["2025-07-28"]],
    ["Sept 3rd 2025", ["2025-09-03"]],
    ["MARCH 5 2026", ["2026-03-05"]],
    ["Dated 02 Dec 2027 at Perth", ["2027-12-02"]],
  ])("reads %j", (text, expected) => {
    expect(datesIn(text)).toEqual(expected);
  });

  it.each([
    ["31/04/2026", "30 April has no 31st"],
    ["29/02/2025", "2025 is not a leap year"],
    ["00/03/2026", "day 0"],
    ["16/13/2026", "month 13"],
    ["31 June 2025", "June has 30 days"],
    ["Feb 30, 2026", "February has no 30th"],
    ["12 Foo 2025", "not a month"],
    ["Maybe 5 2025", "a word that only starts with a month name"],
    ["16/03/202", "three-digit year"],
    ["01/01/0050", "year 50"],
  ])("ignores %j (%s)", (text) => {
    expect(datesIn(text)).toEqual([]);
  });

  it.each([
    ["Ref 12/05/1066", "year 1066 is before 1900"],
    ["3 March 2999", "year 2999 is after 2199"],
    ["March 3, 2200", "2200 is just past the range"],
    ["16/03/2200", "2200 numeric"],
    ["01/01/1899", "1899 is just before the range"],
    ["16-Mar-9999", "stamp style, year 9999"],
  ])("ignores %j (%s): outside 1900-2199", (text) => {
    expect(datesIn(text)).toEqual([]);
  });

  it("keeps the range ends and skips an out-of-range date without hiding a later in-range one", () => {
    expect(datesIn("1/1/1900 and 31/12/2199")).toEqual(["1900-01-01", "2199-12-31"]);
    expect(datesIn("Ref 12/05/1066 dated 3 March 2026")).toEqual(["2026-03-03"]);
  });

  it("accepts 29 February in a leap year", () => {
    expect(datesIn("29/02/2028")).toEqual(["2028-02-29"]);
  });

  it("returns every date in reading order across formats and keeps going after an invalid one", () => {
    expect(datesIn("Lodged 5 March 2026, varied 31/02/2026, expires 07/09/27 (July 4, 2030)")).toEqual([
      "2026-03-05",
      "2027-09-07",
      "2030-07-04",
    ]);
  });

  it("returns nothing for text without dates", () => {
    expect(datesIn("")).toEqual([]);
    expect(datesIn("Lot 12 on Plan 2026")).toEqual([]);
  });
});

describe("dateFromFileName (PRODUCT_SPEC §10.1 step 1)", () => {
  it.each([
    ["Conformance 20260316.pdf", "2026-03-16"],
    ["Conformance 2026-03-16.pdf", "2026-03-16"],
    ["conformance_2026_3_6.pdf", "2026-03-06"],
    ["Conformance.2026.03.16.pdf", "2026-03-16"],
    ["Conformed 16-03-2026.pdf", "2026-03-16"],
    ["conformed_6_3_2026_final.pdf", "2026-03-06"],
    ["16.03.2026.pdf", "2026-03-16"],
    ["20261301 then 20260316.pdf", "2026-03-16"],
    ["20260316_20260317.pdf", "2026-03-16"],
    ["31-02-2026 and 2026-03-17.pdf", "2026-03-17"],
  ])("%j -> %s", (name, expected) => {
    expect(dateFromFileName(name)).toBe(expected);
  });

  it.each([
    "Conformance Notification.pdf",
    "",
    "1202603161.pdf",
    "20261301.pdf",
    "2026-02-30.pdf",
    "31-02-2026.pdf",
    "16-03-26.pdf",
    "Lot 123 plan 4567.pdf",
  ])("finds nothing in %j", (name) => {
    expect(dateFromFileName(name)).toBeNull();
  });
});

describe("isReadableDate", () => {
  it("is the 1900-01-01..2199-12-31 range the API accepts", () => {
    expect([READABLE_DATE_MIN, READABLE_DATE_MAX]).toEqual(["1900-01-01", "2199-12-31"]);
    expect(isReadableDate("1900-01-01")).toBe(true);
    expect(isReadableDate("2199-12-31")).toBe(true);
    expect(isReadableDate("1899-12-31")).toBe(false);
    expect(isReadableDate("2200-01-01")).toBe(false);
    expect(isReadableDate("2026-02-30")).toBe(false);
  });
});
