import { describe, expect, it } from "vitest";
import { nextManifest, planObjectSync, type Manifest, type SourceObject } from "./object-sync.js";

const now = new Date("2026-10-09T00:00:00Z");
const daysAgo = (n: number): string => new Date(now.getTime() - n * 86_400_000).toISOString();
const src = (key: string, size = 10, etag = "e1"): SourceObject => ({ key, size, etag });
const entry = (size = 10, etag = "e1", missingSince: string | null = null) => ({
  size,
  etag,
  copiedAt: daysAgo(3),
  missingSince,
});
const plan = (over: Partial<Parameters<typeof planObjectSync>[0]>) =>
  planObjectSync({ source: [], manifest: {}, copies: new Map(), now, retentionDays: 35, ...over });

describe("planObjectSync", () => {
  it("copies a source object that was never copied", () => {
    expect(plan({ source: [src("jobs/a/1")] }).copy).toEqual([src("jobs/a/1")]);
  });

  it("copies nothing when manifest, copy and source agree", () => {
    const p = plan({
      source: [src("jobs/a/1")],
      manifest: { "jobs/a/1": entry() },
      copies: new Map([["jobs/a/1", 10]]),
    });
    expect(p).toEqual({ copy: [], newlyMissing: new Map(), reappeared: [], purge: [], forget: [] });
  });

  it("recopies when the source size or etag changed", () => {
    const manifest: Manifest = { "jobs/a/1": entry(), "jobs/a/2": entry() };
    const copies = new Map([
      ["jobs/a/1", 10],
      ["jobs/a/2", 10],
    ]);
    const p = plan({ source: [src("jobs/a/1", 11, "e1"), src("jobs/a/2", 10, "e2")], manifest, copies });
    expect(p.copy.map((o) => o.key)).toEqual(["jobs/a/1", "jobs/a/2"]);
  });

  it("recopies when the copy is missing or has the wrong size", () => {
    const manifest: Manifest = { "jobs/a/1": entry(), "jobs/a/2": entry() };
    const p = plan({ source: [src("jobs/a/1"), src("jobs/a/2")], manifest, copies: new Map([["jobs/a/2", 9]]) });
    expect(p.copy.map((o) => o.key)).toEqual(["jobs/a/1", "jobs/a/2"]);
  });

  it("records a source that disappeared, keeping its copy for now", () => {
    const p = plan({ manifest: { "jobs/a/1": entry() }, copies: new Map([["jobs/a/1", 10]]) });
    expect(p.newlyMissing).toEqual(new Map([["jobs/a/1", 10]]));
    expect(p.purge).toEqual([]);
  });

  it("keeps a copy whose source has been gone no longer than the retention period", () => {
    const p = plan({
      manifest: { "jobs/a/1": entry(10, "e1", daysAgo(35)) },
      copies: new Map([["jobs/a/1", 10]]),
    });
    expect(p.purge).toEqual([]);
    expect(p.newlyMissing.size).toBe(0);
  });

  it("purges a copy whose source has been gone longer than the retention period", () => {
    const p = plan({
      manifest: { "jobs/a/1": entry(10, "e1", daysAgo(36)), "jobs/a/2": entry(10, "e1", daysAgo(2)) },
      copies: new Map([
        ["jobs/a/1", 10],
        ["jobs/a/2", 10],
      ]),
    });
    expect(p.purge).toEqual(["jobs/a/1"]);
  });

  it("drops the record when the copy is already gone", () => {
    const p = plan({ manifest: { "jobs/a/1": entry(10, "e1", daysAgo(40)) } });
    expect(p.forget).toEqual(["jobs/a/1"]);
    expect(p.purge).toEqual([]);
  });

  it("notices a source that came back", () => {
    const p = plan({
      source: [src("jobs/a/1")],
      manifest: { "jobs/a/1": entry(10, "e1", daysAgo(5)) },
      copies: new Map([["jobs/a/1", 10]]),
    });
    expect(p.reappeared).toEqual(["jobs/a/1"]);
    expect(p.copy).toEqual([]);
  });

  it("starts the retention clock for a copy found without a record whose source is gone", () => {
    const p = plan({ copies: new Map([["jobs/zz/9", 77]]) });
    expect(p.newlyMissing).toEqual(new Map([["jobs/zz/9", 77]]));
  });

  it("copies again an unrecorded copy whose source still exists", () => {
    const p = plan({ source: [src("jobs/a/1")], copies: new Map([["jobs/a/1", 10]]) });
    expect(p.copy).toEqual([src("jobs/a/1")]);
    expect(p.newlyMissing.size).toBe(0);
  });
});

describe("nextManifest", () => {
  it("records copies, missing sources and reappearances, and removes purged and forgotten entries", () => {
    const manifest: Manifest = {
      "jobs/old/1": entry(10, "e1", daysAgo(40)),
      "jobs/old/2": entry(10, "e1", daysAgo(50)),
      "jobs/back/1": entry(10, "e1", daysAgo(5)),
      "jobs/gone/1": entry(10, "e1"),
    };
    const p = plan({
      source: [src("jobs/new/1", 5, "n1"), src("jobs/back/1")],
      manifest,
      copies: new Map([
        ["jobs/old/1", 10],
        ["jobs/back/1", 10],
        ["jobs/gone/1", 10],
      ]),
    });
    const next = nextManifest(manifest, p, { copied: p.copy, purged: p.purge }, now);
    expect(Object.keys(next).sort()).toEqual(["jobs/back/1", "jobs/gone/1", "jobs/new/1"]);
    expect(next["jobs/new/1"]).toEqual({ size: 5, etag: "n1", copiedAt: now.toISOString(), missingSince: null });
    expect(next["jobs/back/1"]?.missingSince).toBeNull();
    expect(next["jobs/gone/1"]?.missingSince).toBe(now.toISOString());
  });

  it("keeps the old record of a copy that failed, so the next run tries again", () => {
    const manifest: Manifest = { "jobs/a/1": entry(10, "e1") };
    const p = plan({ source: [src("jobs/a/1", 11, "e2")], manifest, copies: new Map([["jobs/a/1", 10]]) });
    const next = nextManifest(manifest, p, { copied: [], purged: [] }, now);
    expect(next["jobs/a/1"]).toEqual(manifest["jobs/a/1"]);
  });

  it("does not drop a record whose copy could not be deleted", () => {
    const manifest: Manifest = { "jobs/a/1": entry(10, "e1", daysAgo(40)) };
    const p = plan({ manifest, copies: new Map([["jobs/a/1", 10]]) });
    expect(p.purge).toEqual(["jobs/a/1"]);
    expect(nextManifest(manifest, p, { copied: [], purged: [] }, now)["jobs/a/1"]).toBeDefined();
  });

  it("creates a record for an unrecorded copy whose source is gone", () => {
    const p = plan({ copies: new Map([["jobs/zz/9", 77]]) });
    expect(nextManifest({}, p, { copied: [], purged: [] }, now)["jobs/zz/9"]).toEqual({
      size: 77,
      etag: "",
      copiedAt: now.toISOString(),
      missingSince: now.toISOString(),
    });
  });
});
