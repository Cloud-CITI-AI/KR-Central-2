// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installMapUpsert } from "./map-upsert";

const pdfjsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../public/pdfjs");

const REMOVE = `for (const C of [Map, WeakMap]) { delete C.prototype.getOrInsert; delete C.prototype.getOrInsertComputed; }`;

/** The Map and WeakMap of a fresh global that lacks the ES2026 upsert methods (browsers from before about early 2026, iOS Safari included), after running `script` in it. */
function oldGlobals(script = ""): { Map: MapConstructor; WeakMap: WeakMapConstructor } {
  return runInNewContext(`${REMOVE}\n${script}\n({ Map, WeakMap })`) as {
    Map: MapConstructor;
    WeakMap: WeakMapConstructor;
  };
}

interface Upsert {
  getOrInsert: (key: unknown, value: unknown) => unknown;
  getOrInsertComputed: (key: unknown, callback: (key: unknown) => unknown) => unknown;
}

function expectUpsertBehaviour(make: () => Upsert & { has: (key: never) => boolean }, key: never) {
  const map = make();
  expect(map.getOrInsert(key, "first")).toBe("first");
  expect(map.getOrInsert(key, "second")).toBe("first");
  const computed = make();
  const calls: unknown[] = [];
  expect(
    computed.getOrInsertComputed(key, (k) => {
      calls.push(k);
      return "made";
    }),
  ).toBe("made");
  expect(computed.getOrInsertComputed(key, () => "again")).toBe("made");
  expect(calls).toEqual([key]);
  expect(() => computed.getOrInsertComputed(key, "not a function" as never)).toThrow(/not a function/);
}

describe("installMapUpsert", () => {
  it("adds getOrInsert and getOrInsertComputed to Map and WeakMap when the browser lacks them", () => {
    const scope = oldGlobals();
    expect("getOrInsertComputed" in scope.Map.prototype).toBe(false);
    installMapUpsert(scope);
    expectUpsertBehaviour(() => new scope.Map() as unknown as Upsert & { has: (key: never) => boolean }, "k" as never);
    expectUpsertBehaviour(
      () => new scope.WeakMap() as unknown as Upsert & { has: (key: never) => boolean },
      {} as never,
    );
    expect(Object.keys(scope.Map.prototype)).toEqual([]);
  });

  it("leaves the browser's own methods alone", () => {
    const scope = oldGlobals();
    const own = () => "native";
    Object.defineProperty(scope.Map.prototype, "getOrInsert", { value: own, configurable: true, writable: true });
    installMapUpsert(scope);
    expect((scope.Map.prototype as unknown as Upsert).getOrInsert).toBe(own);
    expect("getOrInsertComputed" in scope.Map.prototype).toBe(true);
  });
});

describe("public/pdfjs polyfill for the pdf.js worker", () => {
  it("installs the same methods as the page does, in a worker global that lacks them", () => {
    const source = readFileSync(join(pdfjsDir, "map-upsert-polyfill.mjs"), "utf8");
    expect(source).not.toMatch(/^\s*(import|export)\b/m);
    const scope = oldGlobals(source);
    expectUpsertBehaviour(() => new scope.Map() as unknown as Upsert & { has: (key: never) => boolean }, "k" as never);
    expectUpsertBehaviour(
      () => new scope.WeakMap() as unknown as Upsert & { has: (key: never) => boolean },
      {} as never,
    );
  });

  it("loads the polyfill before the shipped pdf.js worker, in that order", () => {
    const wrapper = readFileSync(join(pdfjsDir, "pdf.worker.polyfilled.mjs"), "utf8");
    const imports = [...wrapper.matchAll(/^import\s+"([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports).toEqual(["./map-upsert-polyfill.mjs", "./pdf.worker.min.mjs"]);
  });
});
