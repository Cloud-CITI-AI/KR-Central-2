import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey, persistDrafts, registerDraft, takeDraft } from "./drafts";

const KEY = draftKey("user-1", "job-1", "i8_3", "krNote");

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("draftKey", () => {
  it("is keyed by user, then the parts that name the field", () => {
    expect(KEY).toBe("kr-draft:user-1:job-1:i8_3:krNote");
    expect(draftKey("user-2", "job-1", "i8_3", "krNote")).not.toBe(KEY);
  });
});

describe("persistDrafts", () => {
  it("stores what every registered active field holds, and skips fields that are not active", () => {
    const stop = [
      registerDraft(KEY, () => ({ text: "Synthetic partial comment plus more", base: "Synthetic partial comment" })),
      registerDraft(draftKey("user-1", "job-1", "note"), () => null),
    ];
    persistDrafts(1_000);
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "null")).toEqual({
      text: "Synthetic partial comment plus more",
      base: "Synthetic partial comment",
      savedAt: 1_000,
    });
    expect(window.sessionStorage.getItem(draftKey("user-1", "job-1", "note"))).toBeNull();
    for (const unregister of stop) unregister();
  });

  it("forgets a field once it is unregistered", () => {
    const unregister = registerDraft(KEY, () => ({ text: "x", base: "" }));
    unregister();
    persistDrafts();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the newest registration of a key when an older one is unregistered late", () => {
    const stopFirst = registerDraft(KEY, () => ({ text: "first", base: "" }));
    const stopSecond = registerDraft(KEY, () => ({ text: "second", base: "" }));
    stopFirst();
    persistDrafts(5);
    expect(takeDraft(KEY, 6)?.text).toBe("second");
    stopSecond();
  });

  it("does not throw when storage is blocked or full: the redirect to sign-in must still happen", () => {
    const stop = registerDraft(KEY, () => ({ text: "x", base: "" }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => {
      persistDrafts();
    }).not.toThrow();
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => {
      persistDrafts();
    }).not.toThrow();
    expect(takeDraft(KEY)).toBeNull();
    stop();
  });

  it("removes drafts older than two hours when it writes", () => {
    window.sessionStorage.setItem(draftKey("user-1", "old"), JSON.stringify({ text: "old", base: "", savedAt: 0 }));
    window.sessionStorage.setItem("unrelated", "keep");
    const stop = registerDraft(KEY, () => ({ text: "x", base: "" }));
    persistDrafts(2 * 60 * 60 * 1000 + 1);
    expect(window.sessionStorage.getItem(draftKey("user-1", "old"))).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
    stop();
  });
});

describe("takeDraft", () => {
  it("returns the stored draft once and removes it", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ text: "typed", base: "saved", savedAt: 10 }));
    expect(takeDraft(KEY, 20)).toEqual({ text: "typed", base: "saved", savedAt: 10 });
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(takeDraft(KEY, 20)).toBeNull();
  });

  it("returns nothing for a draft that is too old, not a draft, or not JSON, and removes it", () => {
    for (const stored of [
      JSON.stringify({ text: "typed", base: "", savedAt: 0 }),
      JSON.stringify({ text: 4, base: "", savedAt: 10 }),
      JSON.stringify({ text: "typed" }),
      "not json",
    ]) {
      window.sessionStorage.setItem(KEY, stored);
      expect(takeDraft(KEY, 3 * 60 * 60 * 1000)).toBeNull();
      expect(window.sessionStorage.getItem(KEY)).toBeNull();
    }
  });
});
