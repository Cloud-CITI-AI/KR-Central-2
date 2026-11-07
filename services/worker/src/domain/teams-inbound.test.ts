import { describe, expect, it } from "vitest";
import type { DeltaItem } from "../clients/graph-drive.js";
import { classifyInbound, layoutIndex, relativeFolder, slotFor } from "./teams-inbound.js";

const ROOT = "/S-0042/102. Subdivision Tracker";
const item = (o: Partial<DeltaItem> & { id: string; name: string }): DeltaItem => ({
  eTag: '"1"',
  size: 10,
  isFolder: false,
  webUrl: null,
  createdByAppId: null,
  parentId: "p",
  parentPath: `${ROOT}/01 Preliminaries/2.0 Site Feature Survey`,
  deleted: false,
  lastModifiedByName: "Sam Surveyor",
  lastModifiedAt: "2026-11-06T00:00:00Z",
  ...o,
});
const conditions = [{ id: "c1", number: 3, agency: "Western Power" }];

describe("relativeFolder and layoutIndex", () => {
  it("resolves paths under the root folder and refuses others", () => {
    expect(relativeFolder(ROOT, ROOT)).toBe("");
    expect(relativeFolder(`${ROOT}/02 WAPC Approval`, ROOT)).toBe("02 WAPC Approval");
    expect(relativeFolder("/S-0042/100. Initial SURVEY", ROOT)).toBeNull();
    expect(relativeFolder(null, ROOT)).toBeNull();
    expect(relativeFolder(`${ROOT}x`, ROOT)).toBeNull();
  });
  it("indexes checkpoint folders, Query emails and evidence folders, never the fee proposal", () => {
    const index = layoutIndex(conditions);
    expect(index.get("01 Preliminaries/2.0 Site Feature Survey")).toEqual({
      kind: "checkpoint",
      checkpointKey: "i2_0",
      emailsOnly: false,
    });
    expect(index.get("02 WAPC Approval/4.3 Queries from WAPC/Query emails")).toEqual({
      kind: "checkpoint",
      checkpointKey: "i4_3",
      emailsOnly: true,
    });
    expect(index.get("03 Western Power/WAPC conditions/Condition 3 evidence")).toEqual({
      kind: "condition",
      conditionId: "c1",
    });
    expect([...index.keys()].some((k) => k.includes("Fee proposal"))).toBe(false);
  });
});

describe("classifyInbound", () => {
  const ctx = (
    own: Record<string, { fileId: string; eTag: string | null }> = {},
    recorded: Record<
      string,
      {
        status: "imported" | "unfiled" | "dismissed" | "seen" | "removed" | "failed" | "importing";
        eTag: string | null;
      }
    > = {},
  ) => ({
    rootPath: ROOT,
    own: new Map(Object.entries(own)),
    recorded: new Map(Object.entries(recorded)),
    conditions,
  });

  it("imports a new file in a known folder, unfiles one elsewhere, ignores folders and items outside the root", () => {
    const actions = classifyInbound(
      [
        item({ id: "a", name: "plan.pdf" }),
        item({ id: "b", name: "notes.pdf", parentPath: ROOT }),
        item({ id: "c", name: "02 WAPC Approval", isFolder: true, parentPath: ROOT }),
        item({ id: "d", name: "outside.pdf", parentPath: "/S-0042/100. Initial SURVEY" }),
        item({
          id: "e",
          name: "photo.png",
          parentPath: `${ROOT}/03 Western Power/WAPC conditions/Condition 3 evidence`,
        }),
      ],
      ctx(),
    );
    expect(actions.map((a) => [a.item.id, a.action])).toEqual([
      ["a", "import"],
      ["b", "unfiled"],
      ["c", "ignore"],
      ["d", "ignore"],
      ["e", "import"],
    ]);
    expect(actions[4]).toMatchObject({ target: { kind: "condition", conditionId: "c1" } });
  });

  it("ignores the app's own unchanged items, reports replaced ones and removed ones", () => {
    const actions = classifyInbound(
      [
        item({ id: "same", name: "plan.pdf", eTag: '"1"' }),
        item({ id: "changed", name: "plan (2).pdf", eTag: '"2"' }),
        item({ id: "gone", name: "(deleted)", deleted: true }),
        item({ id: "stranger-gone", name: "(deleted)", deleted: true }),
        item({ id: "inbound-gone", name: "(deleted)", deleted: true }),
      ],
      ctx(
        {
          same: { fileId: "f1", eTag: '"1"' },
          changed: { fileId: "f2", eTag: '"1"' },
          gone: { fileId: "f3", eTag: '"1"' },
        },
        { "inbound-gone": { status: "unfiled", eTag: '"1"' } },
      ),
    );
    expect(actions.map((a) => [a.item.id, a.action])).toEqual([
      ["same", "ignore"],
      ["changed", "replaced"],
      ["gone", "removed"],
      ["stranger-gone", "ignore"],
      ["inbound-gone", "inbound_removed"],
    ]);
  });

  it("re-examines a recorded item only when it changed, and never one dismissed with the same eTag", () => {
    const recorded = ctx(
      {},
      {
        a: { status: "dismissed", eTag: '"1"' },
        b: { status: "imported", eTag: '"1"' },
        c: { status: "failed", eTag: '"1"' },
      },
    );
    const actions = classifyInbound(
      [
        item({ id: "a", name: "x.pdf", eTag: '"1"' }),
        item({ id: "b", name: "y.pdf", eTag: '"2"' }),
        item({ id: "c", name: "z.pdf", eTag: '"1"' }),
      ],
      recorded,
    );
    expect(actions.map((a) => a.action)).toEqual(["ignore", "import", "ignore"]);
  });
});

describe("slotFor", () => {
  it("picks the requested slot when it accepts the kind, else the first that does, else nothing", () => {
    expect(slotFor("i2_0", "pdf", null, false)).toBe("survey");
    expect(slotFor("i2_0", "pdf", "survey", false)).toBe("survey");
    expect(slotFor("i2_0", "pdf", "nope", false)).toBeNull();
    expect(slotFor("i4_3", "email", null, true)).toBe("email");
    expect(slotFor("i4_3", "pdf", null, true)).toBeNull();
    expect(slotFor("unknown", "pdf", null, false)).toBeNull();
  });
});
