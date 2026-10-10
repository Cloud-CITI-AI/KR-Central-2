import { CreateJobRequest, JobStatusFilter, SubdivisionType } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { DASHBOARD_STATUSES, dashboardHref, parseDashboardParams } from "./params";

const search = (text: string) => new URLSearchParams(text);

describe("parseDashboardParams", () => {
  it("defaults to the in-progress filter with no type, search or archived job", () => {
    expect(parseDashboardParams(search(""))).toEqual({ status: "in_progress", type: "", q: "", archived: "" });
  });

  it("reads valid values", () => {
    expect(parseDashboardParams(search("status=complete&type=Freehold&q=main+st&archived=S-0001"))).toEqual({
      status: "complete",
      type: "Freehold",
      q: "main st",
      archived: "S-0001",
    });
  });

  it("falls back to the defaults for values that are not part of the contract", () => {
    const parsed = parseDashboardParams(search(`status=bogus&type=Skyscraper&q=${"x".repeat(150)}`));
    expect(parsed).toMatchObject({ status: "in_progress", type: "" });
    expect(parsed.q).toHaveLength(100);
  });
});

describe("parseDashboardParams archived", () => {
  it.each(["Your account was hacked, call 555-0100", "<b>x</b>", "-S-1", "S-".concat("1".repeat(40)), "   "])(
    "drops %j because it is not a job number",
    (value) => {
      expect(parseDashboardParams(search(`archived=${encodeURIComponent(value)}`)).archived).toBe("");
    },
  );

  it("keeps a job number, trimmed", () => {
    expect(parseDashboardParams(search("archived=%20S-0001%20")).archived).toBe("S-0001");
  });
});

/** params.ts writes the contract's rules out (no Zod on the first render); these keep the two from drifting. */
describe("parseDashboardParams against the contract schemas", () => {
  it("accepts exactly the statuses and subdivision types the contract lists", () => {
    expect([...DASHBOARD_STATUSES]).toEqual(JobStatusFilter.options);
    for (const type of SubdivisionType.options) {
      expect(parseDashboardParams(search(`type=${encodeURIComponent(type)}`)).type).toBe(type);
    }
    expect(parseDashboardParams(search("type=freehold")).type).toBe("");
  });

  it.each([
    "S-0001",
    " S-0001 ",
    "S 0001/2.1",
    "a",
    "S-".concat("1".repeat(30)),
    "S-".concat("1".repeat(31)),
    "",
    "   ",
    "-S-1",
    ".1",
    "S_1",
    "S-1\n",
    "<b>x</b>",
  ])("treats the archived job number %j as the contract's job number does", (value) => {
    const parsed = CreateJobRequest.shape.jobNumber.safeParse(value);
    expect(parseDashboardParams(search(`archived=${encodeURIComponent(value)}`)).archived).toBe(
      parsed.success ? parsed.data : "",
    );
  });
});

describe("dashboardHref", () => {
  it("leaves defaults out of the URL", () => {
    expect(dashboardHref("/", search("status=complete"), { status: "in_progress" })).toBe("/");
  });

  it("sets a filter and keeps the others and unrelated parameters", () => {
    expect(dashboardHref("/", search("type=Freehold&utm=1"), { status: "all", q: "  lot 5 " })).toBe(
      "/?type=Freehold&utm=1&status=all&q=lot+5",
    );
  });

  it("clears a type with an empty value", () => {
    expect(dashboardHref("/", search("type=Freehold"), { type: "" })).toBe("/");
  });
});
