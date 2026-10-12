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

  it("prints in the light palette whatever the theme (DESIGN_TOKENS §6, white page)", () => {
    // `print-color-adjust: exact` keeps backgrounds in print, so the dark palette would print as dark blocks on the white sheet unless
    // the print block re-declares every light token for both dark selectors.
    const print = css.slice(css.indexOf("@media print {"));
    const darkSelectors = print.slice(0, print.indexOf("{", print.indexOf("{") + 1));
    expect(darkSelectors).toContain(':root:not([data-theme="light"])');
    expect(darkSelectors).toContain(':root[data-theme="dark"]');
    const light = block(":root {");
    const declarations = light.split("\n").filter((line) => /^\s+--[\w-]+:/.test(line));
    expect(declarations.length).toBeGreaterThan(30);
    for (const line of declarations) expect(print, line.trim()).toContain(line.trim());
    expect(print).toContain("color-scheme: light;");
  });

  describe("WCAG 2.2 AA text contrast (1.4.3, known defect D3)", () => {
    const channel = (hex: string, at: number): number => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string): number =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const ratio = (a: string, b: string): number => {
      const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const surfaces = ["surface", "field", "redBg", "greenBg", "greyBg", "accentSoft"] as const;

    it.each([
      ["light", lightColors],
      ["dark", darkColors],
    ] as const)("keeps the secondary text colours at 4.5:1 or more on every %s surface", (_theme, colors) => {
      for (const text of ["ink", "ink2", "ink3"] as const)
        for (const surface of surfaces)
          expect(ratio(colors[text], colors[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    });

    it.each([
      ["light", lightColors],
      ["dark", darkColors],
    ] as const)(
      "keeps the accent link ink (D7) at 4.5:1 or more on every %s surface, tints included",
      (_theme, colors) => {
        for (const surface of surfaces)
          expect(ratio(colors.accentInk, colors[surface]), `accentInk on ${surface}`).toBeGreaterThanOrEqual(4.5);
      },
    );

    it.each([
      ["light", lightColors],
      ["dark", darkColors],
    ] as const)("keeps the status ink on its own %s tint at 4.5:1 or more", (_theme, colors) => {
      for (const status of ["red", "green", "grey"] as const)
        expect(ratio(colors[`${status}Ink`], colors[`${status}Bg`]), status).toBeGreaterThanOrEqual(4.5);
    });
  });
});
