import { describe, expect, it } from "vitest";
import { queryKeys } from "./keys";

describe("queryKeys", () => {
  it("nests every jobs key under jobs.all so one invalidation covers them", () => {
    for (const key of [
      queryKeys.jobs.list({ status: "all" }),
      queryKeys.jobs.facets(),
      queryKeys.jobs.detail("j1"),
      queryKeys.jobs.notes("j1"),
    ]) {
      expect(key.slice(0, 1)).toEqual(queryKeys.jobs.all);
    }
  });

  it("differs per id and per query, and is equal for equal inputs", () => {
    expect(queryKeys.jobs.detail("a")).not.toEqual(queryKeys.jobs.detail("b"));
    expect(queryKeys.jobs.detail("a")).not.toEqual(queryKeys.jobs.notes("a"));
    expect(queryKeys.jobs.list({ q: "x" })).toEqual(queryKeys.jobs.list({ q: "x" }));
    expect(queryKeys.jobs.list({ q: "x" })).not.toEqual(queryKeys.jobs.list({ q: "y" }));
    expect(queryKeys.operation("o1")).toEqual(["operations", "o1"]);
  });

  it("keeps the admin lists apart", () => {
    const heads = [queryKeys.grants()[0], queryKeys.audit()[0], queryKeys.users()[0], queryKeys.me[0]];
    expect(new Set(heads).size).toBe(4);
  });
});
