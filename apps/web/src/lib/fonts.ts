import localFont from "next/font/local";

/**
 * Yantramanav, self-hosted from `src/lib/fonts` (SIL OFL 1.1, LICENSE-OFL.txt beside the files; DESIGN_TOKENS §2).
 * next/font/local inlines the @font-face rules and hashes the family name; nothing is fetched from Google at build or
 * run time, so the production build no longer needs internet access and users never contact fonts.googleapis.com.
 */
export const yantramanav = localFont({
  src: [
    { path: "./fonts/yantramanav-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "./fonts/yantramanav-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/yantramanav-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/yantramanav-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});
