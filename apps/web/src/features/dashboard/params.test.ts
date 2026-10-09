import { describe, expect, it } from "vitest";
import { dashboardHref, parseDashboardParams } from "./params";

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
