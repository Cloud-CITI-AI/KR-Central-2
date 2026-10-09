import { describe, expect, it } from "vitest";
import { decodeNoteCursor, encodeNoteCursor } from "./cursor.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("note cursor", () => {
  it("round-trips a note id", () => {
    expect(decodeNoteCursor(encodeNoteCursor(ID))).toBe(ID);
  });

  it.each([
    ["not base64 json", "!!!"],
    ["json without an id", Buffer.from("{}").toString("base64url")],
    ["an id that is not a uuid", Buffer.from('{"i":"abc"}').toString("base64url")],
    ["extra keys", Buffer.from(`{"i":"${ID}","x":1}`).toString("base64url")],
    ["a json array", Buffer.from("[1]").toString("base64url")],
  ])("rejects %s", (_name, raw) => {
    expect(decodeNoteCursor(raw)).toBeNull();
  });
});
