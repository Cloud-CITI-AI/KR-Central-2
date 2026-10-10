/** The part of a global scope the polyfill touches: `globalThis` in the page, a fresh one in tests. */
interface UpsertGlobals {
  readonly Map: MapConstructor;
  readonly WeakMap: WeakMapConstructor;
}

type Upsertable = Map<unknown, unknown> | WeakMap<WeakKey, unknown>;
type Slot = Record<"getOrInsert" | "getOrInsertComputed", unknown>;

function getOrInsert(this: Upsertable, key: unknown, value: unknown): unknown {
  const map = this as Map<unknown, unknown>;
  if (map.has(key)) return map.get(key);
  map.set(key, value);
  return value;
}

function getOrInsertComputed(this: Upsertable, key: unknown, callback: unknown): unknown {
  if (typeof callback !== "function") throw new TypeError("callback is not a function");
  const map = this as Map<unknown, unknown>;
  if (map.has(key)) return map.get(key);
  const value = (callback as (key: unknown) => unknown)(key);
  map.set(key, value);
  return value;
}

/**
 * `Map.prototype.getOrInsert` and `getOrInsertComputed` (ES2026, in Chrome 145+, Firefox 144+ and Safari 26.2+) are what pdf.js 6 needs to draw a
 * page, on the page and in its worker. Older browsers, iOS Safari included (PRODUCT_SPEC §11.1, §14), would show "couldn't be drawn" for every
 * PDF, so the viewer installs them before it loads pdf.js (the worker does the same: public/pdfjs/map-upsert-polyfill.mjs). Idempotent, and
 * a browser's own methods are never replaced.
 */
export function installMapUpsert(scope: UpsertGlobals = globalThis): void {
  for (const collection of [scope.Map, scope.WeakMap]) {
    const prototype = collection.prototype as unknown as Slot;
    if (!prototype.getOrInsert) {
      Object.defineProperty(prototype, "getOrInsert", { configurable: true, writable: true, value: getOrInsert });
    }
    if (!prototype.getOrInsertComputed) {
      Object.defineProperty(prototype, "getOrInsertComputed", {
        configurable: true,
        writable: true,
        value: getOrInsertComputed,
      });
    }
  }
}
