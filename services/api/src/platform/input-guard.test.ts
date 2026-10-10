import { describe, expect, it } from "vitest";
import { NUL_MESSAGE, findNulFields } from "./input-guard.js";

describe("findNulFields", () => {
  it("returns nothing for clean input", () => {
    expect(findNulFields({ body: { a: "x", b: ["y", { c: 1 }], d: null }, query: { q: "z" }, params: {} })).toEqual([]);
    expect(findNulFields({ body: undefined, query: undefined, params: undefined })).toEqual([]);
  });

  it("names top-level, nested and array paths", () => {
    expect(
      findNulFields({ body: { a: "x\0", n: { list: ["ok", { k: "\0" }] } }, query: { q: "\0" }, params: {} }),
    ).toEqual([
      { path: "a", message: NUL_MESSAGE },
      { path: "n.list.1.k", message: NUL_MESSAGE },
      { path: "q", message: NUL_MESSAGE },
    ]);
  });

  it("names a bare string body or query by its request part, and checks object keys", () => {
    expect(findNulFields({ body: "a\0", query: {}, params: {} })).toEqual([{ path: "body", message: NUL_MESSAGE }]);
    expect(findNulFields({ body: { "k\0": 1 } })).toEqual([{ path: "k\0", message: NUL_MESSAGE }]);
  });

  it("ignores streams and buffers, and caps the report", () => {
    expect(findNulFields({ body: Buffer.from("a\0b") })).toEqual([]);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, "\0"]));
    expect(findNulFields({ body: many })).toHaveLength(10);
  });

  it("walks arbitrarily deep input without overflowing the stack", () => {
    const nest = (depth: number, leaf: unknown): unknown => {
      let v: unknown = leaf;
      for (let i = 0; i < depth; i++) v = [v];
      return v;
    };
    expect(findNulFields({ body: nest(200_000, "clean") })).toEqual([]);
    const found = findNulFields({ body: nest(200_000, "a\0") });
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe(NUL_MESSAGE);
    expect(found[0]?.path.split(".")).toHaveLength(200_000);
  });

  it("reports fields in their original order", () => {
    expect(findNulFields({ body: { a: { x: "\0" }, b: "\0", c: ["\0"] } }).map((e) => e.path)).toEqual([
      "a.x",
      "b",
      "c.0",
    ]);
  });
});
