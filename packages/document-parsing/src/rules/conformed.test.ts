import { describe, expect, it } from "vitest";
import { syntheticFaker } from "../../test/fixtures/builders.js";
import { fromFileName, fromStampAnnotation, fromText } from "./conformed.js";

describe("fromFileName", () => {
  it.each([
    ["Conformance Notification 20260316.pdf", "2026-03-16"],
    ["conformed_16-03-2026.pdf", "2026-03-16"],
    ["Conf.2026.03.16.pdf", "2026-03-16"],
  ])("%j", (name, date) => {
    expect(fromFileName(name)).toEqual({ date, method: "file_name" });
  });

  it.each(["Conformance.pdf", "20261340.pdf", ""])("returns null for %j", (name) => {
    expect(fromFileName(name)).toBeNull();
  });
});

describe("fromStampAnnotation", () => {
  it.each<[string[], string]>([
    [["DATE 16-Mar-2026 FILE 123-26"], "2026-03-16"],
    [["Approved", "Received 5/3/2026 Stamp"], "2026-03-05"],
    [["no date here", "DATE 16/03/2026", "DATE 17/03/2026"], "2026-03-16"],
  ])("reads %j", (texts, date) => {
    expect(fromStampAnnotation(texts)).toEqual({ date, method: "stamp_annotation" });
  });

  it.each<[string[]]>([[[]], [[""]], [[`Approved by ${syntheticFaker().person.fullName()}`]], [["DATE 31-Feb-2026"]]])(
    "returns null for %j",
    (texts) => {
      expect(fromStampAnnotation(texts)).toBeNull();
    },
  );
});

describe("fromText", () => {
  it.each<[string, string[], string]>([
    ["same line", ["Letter 1 January 2026", "Conformed on 16 March 2026"], "2026-03-16"],
    ["next line", ["This plan was conformed", "16/03/2026"], "2026-03-16"],
    ["two lines later", ["Conformance notification", "", "WAPC", "16-03-2026"], "2026-03-16"],
    ["case-insensitive", ["CONFORMED COPY DATE 16.03.2026"], "2026-03-16"],
    [
      "a later conform line when the first has none",
      ["conformed", "x", "y", "z", "Conformance 17/03/2026"],
      "2026-03-17",
    ],
  ])("%s", (_name, lines, date) => {
    expect(fromText(lines)).toEqual({ date, method: "text" });
  });

  it.each<[string, string[]]>([
    ["three lines away", ["conformed", "a", "b", "16/03/2026"]],
    ["date before the conform line only", ["16/03/2026", "conformed"]],
    ["no conform line (the letter date is not a fallback)", ["14 March 2026", "Decision"]],
    ["invalid date", ["conformed 31/02/2026"]],
    ["empty", []],
  ])("returns null: %s", (_name, lines) => {
    expect(fromText(lines)).toBeNull();
  });
});
