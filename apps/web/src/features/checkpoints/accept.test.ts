import { CHECKPOINTS, slotsOf, type FileKind } from "@kr/workflow";
import { describe, expect, it } from "vitest";
import { describeAccept, slotFileRules } from "./accept";

describe("describeAccept", () => {
  it.each([
    [["pdf"], "PDF"],
    [["pdf", "image"], "PDF or photo"],
    [["pdf", "image", "video", "text"], "PDF, photo, video or text"],
    [["pdf", "dwg"], "PDF or DWG"],
    [["email"], "Outlook .msg or .eml email"],
  ] as const)("words %j as %s", (kinds: readonly FileKind[], text) => {
    expect(describeAccept(kinds)).toBe(text);
  });
});

describe("slotFileRules", () => {
  it("turns the accepted kinds into picker extensions, a description and the size limit", () => {
    expect(slotFileRules({ accept: ["pdf", "dwg"] }, 52_428_800)).toEqual({
      accept: [".pdf", ".dwg"],
      acceptDescription: "PDF or DWG",
      maxBytes: 52_428_800,
    });
    expect(slotFileRules({ accept: ["image"] }, 1).accept).toEqual([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
  });

  it("covers every slot of the workflow", () => {
    for (const checkpoint of CHECKPOINTS) {
      for (const slot of slotsOf(checkpoint)) {
        expect(slotFileRules(slot, 1).accept?.length).toBeGreaterThan(0);
      }
    }
  });
});
