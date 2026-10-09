import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readTheme, setTheme, subscribeTheme, THEME_BOOTSTRAP_SCRIPT } from "./theme";

afterEach(() => {
  setTheme("system");
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("sets data-theme and persists light and dark; system clears both", () => {
    setTheme("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("kr-theme")).toBe("dark");
    expect(readTheme()).toBe("dark");
    setTheme("system");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(localStorage.getItem("kr-theme")).toBeNull();
  });

  it("still works for the tab when storage throws (try/catch around every access)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("system");
    setTheme("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(readTheme()).toBe("light");
  });

  it("notifies subscribers, and re-reads when another tab changes the key", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTheme(listener);
    setTheme("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    localStorage.setItem("kr-theme", "light");
    window.dispatchEvent(new StorageEvent("storage", { key: "kr-theme" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readTheme()).toBe("light");
    unsubscribe();
    setTheme("system");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  /** Run the real script string in an isolated context with a fake document and storage. */
  const run = (getItem: () => string | null) => {
    const attributes: Record<string, string> = {};
    const context = {
      localStorage: { getItem },
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
        },
      },
    };
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, context);
    return attributes["data-theme"];
  };

  it("applies a stored light or dark theme and ignores anything else", () => {
    expect(run(() => "dark")).toBe("dark");
    expect(run(() => "light")).toBe("light");
    expect(run(() => "purple")).toBeUndefined();
    expect(run(() => null)).toBeUndefined();
  });

  it("does not throw when storage is blocked", () => {
    expect(
      run(() => {
        throw new Error("blocked");
      }),
    ).toBeUndefined();
  });

  it("contains no character React would escape in a script body", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).not.toMatch(/[<>&"']/);
  });
});
