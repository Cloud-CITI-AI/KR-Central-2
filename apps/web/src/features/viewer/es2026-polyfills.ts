/** The part of a global scope the polyfills touch: `globalThis` in the page, a fresh one in tests. */
type Scope = typeof globalThis;

/** Defines `name` on `target` unless the browser already has a function of that name: a browser's own methods are never replaced. */
function define(target: object, name: string, value: unknown): void {
  if (typeof (target as Record<string, unknown>)[name] !== "function") {
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  }
}

type Upsertable = Map<unknown, unknown> | WeakMap<WeakKey, unknown>;

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

/** Neumaier's compensated sum: exact enough for sizes and widths, and -0, NaN and the infinities behave as `Math.sumPrecise` specifies. */
function sumPrecise(items: Iterable<unknown>): number {
  let sum = 0;
  let compensation = 0;
  let count = 0;
  let onlyNegativeZero = true;
  let nan = false;
  let positiveInfinity = false;
  let negativeInfinity = false;
  for (const x of items) {
    if (typeof x !== "number") throw new TypeError("Math.sumPrecise: items must be numbers");
    count++;
    if (Number.isNaN(x)) nan = true;
    else if (x === Infinity) positiveInfinity = true;
    else if (x === -Infinity) negativeInfinity = true;
    else {
      if (!Object.is(x, -0)) onlyNegativeZero = false;
      const total = sum + x;
      compensation += Math.abs(sum) >= Math.abs(x) ? sum - total + x : x - total + sum;
      sum = total;
    }
  }
  if (nan || (positiveInfinity && negativeInfinity)) return NaN;
  if (positiveInfinity) return Infinity;
  if (negativeInfinity) return -Infinity;
  return count === 0 || onlyNegativeZero ? -0 : sum + compensation;
}

/**
 * The ES2024 to ES2026 built-ins pdf.js 6 calls: `Map.prototype.getOrInsert(Computed)`, `Math.sumPrecise` (the worker needs it for every
 * embedded font and for AES-256 / PDF 2.0 decryption), `Promise.try` and `withResolvers`, `Uint8Array` hex and base64, `Set.prototype.intersection`,
 * `URL.parse` and the `Iterator` global. Older browsers, iOS Safari included (PRODUCT_SPEC §11.1, §14), would otherwise show "couldn't load
 * this PDF" or draw it without its fonts, so the viewer installs them before it loads pdf.js (the worker does the same:
 * public/pdfjs/es2026-polyfills.mjs). Idempotent, and a browser's own functions are never replaced.
 */
export function installEs2026Polyfills(scope: Scope = globalThis): void {
  for (const collection of [scope.Map, scope.WeakMap]) {
    define(collection.prototype, "getOrInsert", getOrInsert);
    define(collection.prototype, "getOrInsertComputed", getOrInsertComputed);
  }
  define(scope.Math, "sumPrecise", sumPrecise);

  const withResolvers = function (this: unknown) {
    const resolvers: Record<string, unknown> = {};
    const Constructor = (typeof this === "function" ? this : scope.Promise) as PromiseConstructor;
    resolvers.promise = new Constructor((resolve, reject) => {
      resolvers.resolve = resolve;
      resolvers.reject = reject;
    });
    return resolvers;
  };
  define(scope.Promise, "withResolvers", withResolvers);
  define(
    scope.Promise,
    "try",
    function promiseTry(this: unknown, callback: (...args: unknown[]) => unknown, ...args: unknown[]) {
      const Constructor = (typeof this === "function" ? this : scope.Promise) as PromiseConstructor;
      return new Constructor((resolve) => {
        resolve(callback(...args));
      });
    },
  );

  define(scope.Uint8Array.prototype, "toHex", function toHex(this: Uint8Array) {
    return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
  define(scope.Uint8Array.prototype, "toBase64", function toBase64(this: Uint8Array) {
    let binary = "";
    for (let start = 0; start < this.length; start += 0x8000) {
      binary += String.fromCharCode(...this.subarray(start, start + 0x8000));
    }
    return scope.btoa(binary);
  });
  define(scope.Uint8Array, "fromBase64", function fromBase64(text: string) {
    return scope.Uint8Array.from(scope.atob(text), (character) => character.charCodeAt(0));
  });

  define(
    scope.Set.prototype,
    "intersection",
    function intersection(this: Set<unknown>, other: { has: (value: unknown) => boolean }) {
      const result = new scope.Set<unknown>();
      for (const value of this) if (other.has(value)) result.add(value);
      return result;
    },
  );

  // A URL that does not parse is `null`, not an exception.
  define(scope.URL, "parse", function parse(url: string, base?: string) {
    try {
      return new scope.URL(url, base);
    } catch {
      return null;
    }
  });

  // pdf.js adds `Iterator.prototype.join` at load time and so needs the global itself, which Safari before 18.4 lacks.
  if (typeof (scope as { Iterator?: unknown }).Iterator !== "function") {
    const Iterator = function Iterator() {
      throw new TypeError("Abstract class Iterator not directly constructable");
    };
    const arrayIterator = scope.Object.getPrototypeOf(new scope.Array()[Symbol.iterator]()) as object;
    Object.defineProperty(Iterator, "prototype", { value: scope.Object.getPrototypeOf(arrayIterator) as object });
    Object.defineProperty(scope, "Iterator", { configurable: true, writable: true, value: Iterator });
  }
}
