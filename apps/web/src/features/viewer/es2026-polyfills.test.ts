// @vitest-environment node
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { installEs2026Polyfills } from "./es2026-polyfills";

/** What a browser from before about early 2026 (iOS Safari included) is missing. */
const REMOVE = `
for (const C of [Map, WeakMap]) { delete C.prototype.getOrInsert; delete C.prototype.getOrInsertComputed; }
delete Math.sumPrecise; delete Promise.try; delete Promise.withResolvers;
delete Uint8Array.fromBase64; delete Uint8Array.prototype.toBase64; delete Uint8Array.prototype.toHex;
delete Set.prototype.intersection; delete URL.parse; delete globalThis.Iterator;
`;

/** The built-ins as a test sees them: the typings do not know them yet. */
interface Modern {
  Map: new () => Upsert;
  WeakMap: new () => Upsert;
  Math: { sumPrecise: (items: Iterable<unknown>) => number };
  Promise: {
    try: (callback: (...args: number[]) => unknown, ...args: number[]) => Promise<unknown>;
    withResolvers: () => {
      promise: Promise<unknown>;
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    };
  };
  Uint8Array: { fromBase64: (text: string) => Uint8Array; new (length: number): Bytes };
  Set: new (values: number[]) => { intersection: (other: Set<number>) => Set<number> };
  URL: { parse: (url: string, base?: string) => { href: string } | null };
  Iterator: { prototype: object; new (): unknown };
  Array: new () => unknown[];
  Object: ObjectConstructor;
}
/** A `Uint8Array` with the ES2026 hex and base64 methods. */
interface Bytes extends Omit<Uint8Array, "map" | "subarray"> {
  toHex: () => string;
  toBase64: () => string;
  subarray: (begin: number, end: number) => Bytes;
  map: (callback: (value: number, index: number) => number) => Bytes;
}
interface Upsert {
  getOrInsert: (key: unknown, value: unknown) => unknown;
  getOrInsertComputed: (key: unknown, callback: (key: unknown) => unknown) => unknown;
}

/** Each way the polyfills ship: installed on the page by the viewer (the worker's copy follows). */
const installers: readonly (readonly [string, (scope: typeof globalThis, context: object) => void])[] = [
  [
    "page",
    (scope) => {
      installEs2026Polyfills(scope);
    },
  ],
];

function oldBrowser(install: (scope: typeof globalThis, context: object) => void): Modern {
  const context = createContext({ URL, atob, btoa });
  runInContext(REMOVE, context);
  const scope = runInContext("globalThis", context) as typeof globalThis;
  install(scope, context);
  return scope as unknown as Modern;
}

describe.each(installers)("ES2026 polyfills (%s)", (_name, install) => {
  it("adds getOrInsert and getOrInsertComputed to Map and WeakMap", () => {
    const scope = oldBrowser(install);
    for (const [collection, key] of [
      [scope.Map, "k"],
      [scope.WeakMap, {}],
    ] as const) {
      const map = new collection();
      expect(map.getOrInsert(key, "first")).toBe("first");
      expect(map.getOrInsert(key, "second")).toBe("first");
      const computed = new collection();
      const calls: unknown[] = [];
      expect(computed.getOrInsertComputed(key, (k) => (calls.push(k), "made"))).toBe("made");
      expect(computed.getOrInsertComputed(key, () => "again")).toBe("made");
      expect(calls).toEqual([key]);
      expect(() => computed.getOrInsertComputed(key, "nope" as never)).toThrow(/not a function/);
    }
  });

  it("adds Math.sumPrecise: sums without drifting and treats -0, NaN and the infinities as the standard says", () => {
    const { sumPrecise } = oldBrowser(install).Math;
    expect(sumPrecise([1, 2, 3])).toBe(6);
    expect(sumPrecise([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumPrecise([1e100, 1, -1e100])).toBe(1);
    expect(sumPrecise(new Set([4, 5]))).toBe(9);
    expect(Object.is(sumPrecise([]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, -0]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, 0]), 0)).toBe(true);
    expect(sumPrecise([1, NaN])).toBeNaN();
    expect(sumPrecise([Infinity, -Infinity])).toBeNaN();
    expect(sumPrecise([Infinity, 1])).toBe(Infinity);
    expect(sumPrecise([-Infinity, 1])).toBe(-Infinity);
    expect(() => sumPrecise(["1"])).toThrow(/must be|not directly/);
  });

  it("adds Promise.try and Promise.withResolvers", async () => {
    const { Promise: P } = oldBrowser(install);
    await expect(P.try((a, b) => a + b, 2, 3)).resolves.toBe(5);
    await expect(
      P.try(() => {
        throw new Error("sync failure");
      }),
    ).rejects.toThrow("sync failure");
    const { promise, resolve } = P.withResolvers();
    resolve("done");
    await expect(promise).resolves.toBe("done");
  });

  it("adds Uint8Array hex and base64, Set intersection and URL.parse", () => {
    const scope = oldBrowser(install);
    const bytes = new scope.Uint8Array(100_000).map((_, i) => i % 256);
    expect(bytes.subarray(0, 3).toHex()).toBe("000102");
    expect(bytes.toBase64()).toBe(Buffer.from(bytes).toString("base64"));
    expect(Array.from(scope.Uint8Array.fromBase64("AAEC/w=="))).toEqual([0, 1, 2, 255]);
    expect([...new scope.Set([1, 2, 3]).intersection(new Set([2, 3, 4]))]).toEqual([2, 3]);
    expect(scope.URL.parse("/a?b=1", "https://example.org/x")?.href).toBe("https://example.org/a?b=1");
    expect(scope.URL.parse("not a url")).toBeNull();
  });

  it("adds the Iterator global, whose prototype is the one array iterators inherit", () => {
    const scope = oldBrowser(install);
    const arrayIterator = scope.Object.getPrototypeOf(new scope.Array()[Symbol.iterator]()) as object;
    expect(scope.Iterator.prototype).toBe(scope.Object.getPrototypeOf(arrayIterator));
    expect(() => new scope.Iterator()).toThrow(/must be|not directly/);
  });
});

describe("installEs2026Polyfills", () => {
  it("leaves the browser's own functions alone and can run twice", () => {
    const scope = oldBrowser(() => undefined);
    const own = () => 42;
    Object.defineProperty(scope.Math, "sumPrecise", { value: own, configurable: true, writable: true });
    Object.defineProperty(scope.Map.prototype, "getOrInsert", { value: own, configurable: true, writable: true });
    installEs2026Polyfills(scope as unknown as typeof globalThis);
    const afterFirst = scope.Promise.try;
    installEs2026Polyfills(scope as unknown as typeof globalThis);
    expect(scope.Math.sumPrecise).toBe(own);
    expect((scope.Map.prototype as unknown as Upsert).getOrInsert).toBe(own);
    expect("getOrInsertComputed" in scope.Map.prototype).toBe(true);
    expect(scope.Promise.try).toBe(afterFirst);
  });
});
