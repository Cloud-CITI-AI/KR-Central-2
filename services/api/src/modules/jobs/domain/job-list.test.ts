import { describe, expect, it } from "vitest";
import {
  compareEntries,
  computeFacets,
  decodeCursor,
  encodeCursor,
  escapeLike,
  matchesStatus,
  paginate,
  searchPattern,
  type ListEntry,
} from "./job-list.js";

const entry = (n: string, o: Partial<ListEntry> = {}): ListEntry => ({
  id: `id-${n}`,
  jobNumber: n,
  subdivisionType: "Freehold",
  isComplete: false,
  isWaitingOnClient: false,
  alertCount: 0,
  ...o,
});

describe("search text", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("plain")).toBe("plain");
    expect(searchPattern("  a_b ")).toBe("%a\\_b%");
  });
});

describe("status filter", () => {
  it("in_progress and complete are exclusive, all is everything", () => {
    const done = entry("A", { isComplete: true });
    expect(matchesStatus("in_progress", done)).toBe(false);
    expect(matchesStatus("complete", done)).toBe(true);
    expect(matchesStatus("all", done)).toBe(true);
    expect(matchesStatus("in_progress", entry("B"))).toBe(true);
    expect(matchesStatus("complete", entry("B"))).toBe(false);
  });
});

describe("ordering", () => {
  const order = (sort: "attention" | "job_number", es: ListEntry[]) =>
    [...es].sort(compareEntries(sort)).map((e) => e.jobNumber);

  it("sorts job numbers naturally and breaks ties by id", () => {
    const es = [entry("S-1000"), entry("S-0099"), entry("S-0420"), entry("s-0099", { id: "id-0" })];
    expect(order("job_number", es)).toEqual(["s-0099", "S-0099", "S-0420", "S-1000"]);
  });

  it("puts the jobs with the most alerts first for the dashboard", () => {
    const es = [
      entry("A", { alertCount: 1 }),
      entry("B", { alertCount: 3 }),
      entry("C"),
      entry("D", { alertCount: 1 }),
    ];
    expect(order("attention", es)).toEqual(["B", "A", "D", "C"]);
    expect(order("job_number", es)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("cursors", () => {
  it("round-trips a position for its own sort only", () => {
    const e = entry("S-0042", { alertCount: 2 });
    const raw = encodeCursor("attention", e);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor("attention", raw)).toEqual({ alertCount: 2, jobNumber: "S-0042", id: e.id });
    expect(decodeCursor("job_number", raw)).toBeNull();
  });

  it.each([
    ["not base64 json", "!!!"],
    ["json scalar", Buffer.from("42").toString("base64url")],
    ["null", Buffer.from("null").toString("base64url")],
    [
      "wrong field types",
      Buffer.from(JSON.stringify({ s: "attention", a: "1", n: "x", i: "y" })).toString("base64url"),
    ],
    [
      "fractional alert count",
      Buffer.from(JSON.stringify({ s: "attention", a: 1.5, n: "x", i: "y" })).toString("base64url"),
    ],
    ["missing id", Buffer.from(JSON.stringify({ s: "attention", a: 1, n: "x" })).toString("base64url")],
  ])("rejects a cursor that is %s", (_name, raw) => {
    expect(decodeCursor("attention", raw)).toBeNull();
  });
});

describe("paginate", () => {
  const all = ["A", "B", "C", "D", "E"].map((n) => entry(n));

  it("returns the first page with a cursor, and continues strictly after it", () => {
    const first = paginate(all, "job_number", null, 2);
    expect(first.items.map((e) => e.jobNumber)).toEqual(["A", "B"]);
    expect(first.nextCursor).not.toBeNull();
    const second = paginate(all, "job_number", decodeCursor("job_number", first.nextCursor ?? ""), 2);
    expect(second.items.map((e) => e.jobNumber)).toEqual(["C", "D"]);
    const last = paginate(all, "job_number", decodeCursor("job_number", second.nextCursor ?? ""), 2);
    expect(last).toEqual({ items: [all[4]], nextCursor: null });
  });

  it("has no cursor when the page is exactly the rest, and copes with an empty set", () => {
    expect(paginate(all, "job_number", null, 5).nextCursor).toBeNull();
    expect(paginate([], "attention", null, 5)).toEqual({ items: [], nextCursor: null });
  });

  it("survives the cursor's job disappearing between pages", () => {
    const first = paginate(all, "job_number", null, 2);
    const without = all.filter((e) => e.jobNumber !== "B");
    expect(paginate(without, "job_number", decodeCursor("job_number", first.nextCursor ?? ""), 2).items).toEqual([
      all[2],
      all[3],
    ]);
  });
});

describe("computeFacets", () => {
  const es = [
    entry("A", { subdivisionType: "Freehold", isWaitingOnClient: true }),
    entry("B", { subdivisionType: "Freehold", isComplete: true, alertCount: 1 }),
    entry("C", { subdivisionType: null, alertCount: 2 }),
    entry("D", { subdivisionType: "Built Strata" }),
  ];

  it("counts statuses, waiting and attention over every job, and types within the status filter", () => {
    const f = computeFacets(es, "in_progress");
    expect(f.statusCounts).toEqual({ in_progress: 3, complete: 1, all: 4 });
    expect(f.waitingOnClient).toBe(1);
    expect(f.needAttention).toBe(2);
    expect(f.typeCounts[""]).toBe(3);
    expect(f.typeCounts.Freehold).toBe(1);
    expect(f.typeCounts["Built Strata"]).toBe(1);
    expect(f.typeCounts["Survey-Strata"]).toBe(0);
    expect(Object.keys(f.typeCounts)).toHaveLength(7);
    expect(computeFacets(es, "complete").typeCounts[""]).toBe(1);
    expect(computeFacets(es, "all").typeCounts[""]).toBe(4);
  });

  it("is all zeros for a caller who sees nothing", () => {
    expect(computeFacets([], "all")).toMatchObject({
      statusCounts: { in_progress: 0, complete: 0, all: 0 },
      waitingOnClient: 0,
      needAttention: 0,
    });
  });
});
