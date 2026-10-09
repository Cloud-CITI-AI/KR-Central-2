/**
 * Design tokens as TypeScript constants (mirrors src/tokens.css; a unit test keeps them in sync).
 * Use CSS variables in components; use these constants only where CSS cannot reach (e.g. canvas, tests).
 */
export const lightColors = {
  field: "#f5f5f3",
  onBg: "#f2f2f0",
  onBg2: "#d6d6d2",
  bg: "#61625d",
  surface: "#ffffff",
  ink: "#303133",
  ink2: "#777777",
  ink3: "#8c8c8c",
  line: "#eaeaea",
  brand: "#141618",
  brandInk: "#ffffff",
  accent: "#d65614",
  accentSoft: "#fbe9df",
  redBg: "#fce8e6",
  redLine: "#efbcb6",
  redInk: "#9b2c22",
  greenBg: "#e3f3e5",
  greenLine: "#a8d6b0",
  greenInk: "#2e6b3a",
  greyBg: "#ebeae8",
  greyLine: "#cfcdc9",
  greyInk: "#6d6c69",
  fee: "#7a5d00",
  feeSoft: "#fbf0b8",
  item: "#1f5f8b",
  itemSoft: "#e1eef7",
  claim: "#a3410b",
  claimSoft: "#fde2cf",
  onStatus: "#ffffff",
} as const;

export type ColorToken = keyof typeof lightColors;

export const darkColors: Record<ColorToken, string> = {
  field: "#1a1c1f",
  onBg: "#eeeeee",
  onBg2: "#a8a8a8",
  bg: "#141618",
  surface: "#1e2023",
  ink: "#eeeeee",
  ink2: "#b3b3b3",
  ink3: "#8a8a8a",
  line: "#34373b",
  brand: "#0d0e10",
  brandInk: "#ffffff",
  accent: "#e8743a",
  accentSoft: "#3d2619",
  redBg: "#3a2320",
  redLine: "#6a3a33",
  redInk: "#f0a79d",
  greenBg: "#1f3324",
  greenLine: "#3d6a47",
  greenInk: "#8fd09c",
  greyBg: "#2c2c2a",
  greyLine: "#454542",
  greyInk: "#9a9994",
  fee: "#e9cf62",
  feeSoft: "#37301a",
  item: "#79b3dd",
  itemSoft: "#1a2c3a",
  claim: "#f0a070",
  claimSoft: "#3d2619",
  onStatus: "#151514",
};

/** camelCase token → CSS custom property name. */
export function cssVar(token: ColorToken): string {
  return `--${token.replace(/([A-Z0-9])/g, (c) => `-${c.toLowerCase()}`).replace(/-(\d)/, "-$1")}`;
}

export const layout = { maxWidth: 1180, gutter: 16, radius: 3 } as const;

/** Breakpoints used by the prototype's media queries (max-width). */
export const breakpoints = { narrow: 520, cfields: 640, stacked: 760 } as const;

export const typography = {
  family: 'Yantramanav, "Segoe UI", system-ui, Helvetica, Arial, sans-serif',
  weights: [300, 400, 500, 700, 900],
  baseSize: 15,
  lineHeight: 1.5,
} as const;

export type ThemePreference = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "kr-theme";
