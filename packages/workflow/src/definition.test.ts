import { describe, expect, it } from "vitest";
import {
  CHECKPOINTS,
  EVIDENCE_ACCEPT,
  STAGES,
  findSlot,
  getCheckpoint,
  isCheckpointKey,
  slotsOf,
} from "./definition.js";

describe("workflow definition", () => {
  it("has 10 stages and 46 checkpoints, matching the prototype", () => {
    expect(STAGES.map((s) => s.name)).toEqual([
      "Preliminaries",
      "WAPC Approval",
      "Western Power",
      "Water Corporation",
      "Local Government",
      "Busselton Water",
      "WAPC",
      "Survey",
      "Landgate",
      "Titles",
    ]);
    expect(CHECKPOINTS).toHaveLength(46);
    expect(STAGES.map((s) => s.checkpoints.length)).toEqual([2, 6, 9, 7, 3, 5, 4, 5, 4, 1]);
  });

  it("uses unique storage keys and unique display numbers", () => {
    expect(new Set(CHECKPOINTS.map((c) => c.key)).size).toBe(46);
    expect(new Set(CHECKPOINTS.map((c) => c.number)).size).toBe(46);
  });

  it("keeps the prototype keys that do not match display numbers", () => {
    const pairs = Object.fromEntries(CHECKPOINTS.map((c) => [c.number, c.key]));
    expect(pairs).toMatchObject({
      "1.0": "i1_0p",
      "3.0": "i3_0p",
      "6.1": "i6_1a",
      "6.2": "i6_1",
      "6.8": "i6_9",
      "8.0": "i8_2",
      "10.0": "i12_0",
      "11.1": "i11_draft",
      "11.2": "i11_1",
      "12.2": "i13_notif",
      "12.3": "i13_2",
      "13.0": "i14_0",
    });
  });

  it("assigns every checkpoint to the stage it is listed under", () => {
    for (const s of STAGES) for (const c of s.checkpoints) expect(c.stage).toBe(s.key);
  });

  it("restricts only the fee proposal", () => {
    expect(CHECKPOINTS.filter((c) => c.restricted).map((c) => c.key)).toEqual(["i1_0p"]);
  });

  it("marks exactly the four optional agency stages as optional", () => {
    expect(STAGES.filter((s) => s.optional).map((s) => s.agency)).toEqual([
      "Western Power",
      "Water Corporation",
      "Local Government",
      "Busselton Water",
    ]);
  });

  it("declares unique slot keys within each checkpoint", () => {
    for (const c of CHECKPOINTS) {
      const keys = slotsOf(c).map((s) => s.key);
      expect(new Set(keys).size, c.key).toBe(keys.length);
    }
  });

  it("finds slots and rejects unknown checkpoints", () => {
    expect(findSlot("i6_9", "clremail")?.accept).toEqual(["pdf"]);
    expect(findSlot("i2_0", "survey")?.requiredKinds).toEqual(["pdf", "dwg"]);
    expect(findSlot("i3_0p", "consent")?.uploaders).toBe("staff_and_client");
    expect(findSlot("i4_0", "documents")).toBeUndefined();
    expect(isCheckpointKey("i13_2")).toBe(true);
    expect(isCheckpointKey("i99_9")).toBe(false);
    expect(() => getCheckpoint("nope")).toThrow(RangeError);
  });

  it("takes the same kinds for condition evidence as for the generic document folders", () => {
    expect(EVIDENCE_ACCEPT).toEqual(["pdf", "image", "video", "text"]);
    expect(findSlot("i13_notif", "documents")?.accept).toEqual(EVIDENCE_ACCEPT);
  });
});
