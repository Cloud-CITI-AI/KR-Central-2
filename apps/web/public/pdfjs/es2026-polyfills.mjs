// The ES2024 to ES2026 built-ins pdf.js 6 calls on the page and in its worker, for browsers that lack them (iOS Safari and Chrome from
// before about early 2026, PRODUCT_SPEC §11.1, §14): without them a page does not draw, an AES-256 PDF does not open and embedded fonts
// are dropped. This is the worker's copy; the page's is src/features/viewer/es2026-polyfills.ts (es2026-polyfills.test.ts keeps the two in
// step). Each one is added only where the browser has no function of that name; the sum is Neumaier's, which is exact enough for sizes.
const define = (target, name, value) => {
  if (typeof target[name] !== "function") {
    Object.defineProperty(target, name, { configurable: true, writable: true, value });
  }
};

for (const C of [Map, WeakMap]) {
  define(C.prototype, "getOrInsert", function getOrInsert(key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  });
  define(C.prototype, "getOrInsertComputed", function getOrInsertComputed(key, callback) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  });
}

define(Math, "sumPrecise", function sumPrecise(items) {
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
    if (x !== x) nan = true;
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
});

define(Promise, "try", function promiseTry(callback, ...args) {
  return new (typeof this === "function" ? this : Promise)((resolve) => resolve(callback(...args)));
});
define(Promise, "withResolvers", function withResolvers() {
  const resolvers = {};
  resolvers.promise = new (typeof this === "function" ? this : Promise)((resolve, reject) => {
    resolvers.resolve = resolve;
    resolvers.reject = reject;
  });
  return resolvers;
});

define(Uint8Array.prototype, "toHex", function toHex() {
  return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join("");
});
define(Uint8Array.prototype, "toBase64", function toBase64() {
  let binary = "";
  for (let start = 0; start < this.length; start += 0x8000) {
    binary += String.fromCharCode(...this.subarray(start, start + 0x8000));
  }
  return btoa(binary);
});
define(Uint8Array, "fromBase64", function fromBase64(text) {
  const binary = atob(text);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
});

define(Set.prototype, "intersection", function intersection(other) {
  const result = new Set();
  for (const value of this) if (other.has(value)) result.add(value);
  return result;
});

// A URL that does not parse is `null`, not an exception.
define(URL, "parse", function parse(url, base) {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
});

// pdf.js adds `Iterator.prototype.join` at load time and so needs the global itself, which Safari before 18.4 lacks.
if (typeof globalThis.Iterator !== "function") {
  const Iterator = function Iterator() {
    throw new TypeError("Abstract class Iterator not directly constructable");
  };
  Iterator.prototype = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  Object.defineProperty(globalThis, "Iterator", { configurable: true, writable: true, value: Iterator });
}
