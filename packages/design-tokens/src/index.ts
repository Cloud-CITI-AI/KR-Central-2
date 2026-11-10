/**
 * Design tokens as TypeScript constants (mirrors src/tokens.css; a unit test keeps them in sync).
 * Use CSS variables in components; use these constants only where CSS cannot reach (e.g. canvas, tests).
 */
export const lightColors = {
  field: "#f4f5f7",
  onBg: "#1f2328",
  onBg2: "#5f646b",
  bg: "#f4f5f7",
  surface: "#ffffff",
  ink: "#1f2328",
  ink2: "#4b5159",
  ink3: "#5f646b",
  line: "#e5e7ea",
  brand: "#141618",
  brandInk: "#ffffff",
  accent: "#d65614",
  accentInk: "#b5410e",
  accentSoft: "#fdeee5",
  redBg: "#fce8e6",
  redLine: "#efbcb6",
  redInk: "#9b2c22",
  greenBg: "#e3f3e5",
  greenLine: "#a8d6b0",
  greenInk: "#2e6b3a",
  greyBg: "#eceef0",
  greyLine: "#cfd3d8",
  greyInk: "#5f646b",
  fee: "#7a5d00",
  feeSoft: "#fbf0b8",
  item: "#1f5f8b",
  itemSoft: "#e4eef6",
  claim: "#a3410b",
  claimSoft: "#fde2cf",
  onStatus: "#ffffff",
} as const;

export type ColorToken = keyof typeof lightColors;

export const darkColors: Record<ColorToken, string> = {
  field: "#15171a",
  onBg: "#e8eaed",
  onBg2: "#9ba1a9",
  bg: "#15171a",
  surface: "#1e2124",
  ink: "#e8eaed",
  ink2: "#b3b8bf",
  ink3: "#9ba1a9",
  line: "#2e3236",
  brand: "#0d0e10",
  brandInk: "#ffffff",
  accent: "#e8743a",
  accentInk: "#ee8450",
  accentSoft: "#3d2619",
  redBg: "#3a2320",
  redLine: "#6a3a33",
  redInk: "#f0a79d",
  greenBg: "#1f3324",
  greenLine: "#3d6a47",
  greenInk: "#8fd09c",
  greyBg: "#2c3034",
  greyLine: "#454a50",
  greyInk: "#a7acb3",
  fee: "#e9cf62",
  feeSoft: "#37301a",
  item: "#79b3dd",
  itemSoft: "#1a2c3a",
  claim: "#f0a070",
  claimSoft: "#3d2619",
  onStatus: "#15171a",
};

/** camelCase token → CSS custom property name. */
export function cssVar(token: ColorToken): string {
  return `--${token.replace(/([A-Z0-9])/g, (c) => `-${c.toLowerCase()}`).replace(/-(\d)/, "-$1")}`;
}

export const layout = { maxWidth: 1240, gutter: 24, radius: 6 } as const;

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
