import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssVar, darkColors, lightColors, type ColorToken } from "./index.js";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selectorStart: string): string {
  const i = css.indexOf(selectorStart);
  return css.slice(i, css.indexOf("}", i));
}

describe("design tokens", () => {
  it("maps camelCase to CSS variable names", () => {
    expect(cssVar("redBg")).toBe("--red-bg");
    expect(cssVar("ink2")).toBe("--ink-2");
    expect(cssVar("onBg2")).toBe("--on-bg-2");
  });

  it("keeps TS light colours in sync with tokens.css", () => {
    const root = block(":root {");
    for (const [k, v] of Object.entries(lightColors)) expect(root, k).toContain(`${cssVar(k as ColorToken)}: ${v};`);
  });

  it("keeps TS dark colours in sync with tokens.css", () => {
    const dark = block(':root[data-theme="dark"]');
    // --brand-ink is not redefined in dark mode (inherits #ffffff), exactly as in the prototype.
    for (const [k, v] of Object.entries(darkColors).filter(([k]) => k !== "brandInk"))
      expect(dark, k).toContain(`${cssVar(k as ColorToken)}: ${v};`);
  });
});
