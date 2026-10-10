// Map.prototype.getOrInsert and getOrInsertComputed (ES2026) for browsers that lack them: pdf.js 6 calls them on the page and
// in its worker, and without them every page of a PDF fails to draw. This is the worker's copy; the page's is
// src/features/viewer/map-upsert.ts (map-upsert.test.ts keeps the two in step). It does nothing where the methods exist.
for (const C of [Map, WeakMap]) {
  if (!C.prototype.getOrInsert) {
    Object.defineProperty(C.prototype, "getOrInsert", {
      configurable: true,
      writable: true,
      value: function getOrInsert(key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
      },
    });
  }
  if (!C.prototype.getOrInsertComputed) {
    Object.defineProperty(C.prototype, "getOrInsertComputed", {
      configurable: true,
      writable: true,
      value: function getOrInsertComputed(key, callback) {
        if (typeof callback !== "function") throw new TypeError("callback is not a function");
        if (this.has(key)) return this.get(key);
        const value = callback(key);
        this.set(key, value);
        return value;
      },
    });
  }
}
