import "@kr/design-tokens/tokens.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { yantramanav } from "@/lib/fonts";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "KR Central", template: "%s | KR Central" },
  description: "KR Surveys' operations portal: the Subdivision Tracker and the tools around it",
};

const HERO_PRELOADS = [
  { href: "/brand/kr-central-hero-800.avif", media: "(max-width: 760px)" },
  { href: "/brand/kr-central-hero-1600.avif", media: "(min-width: 761px)" },
] as const;

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

interface RootLayoutProps {
  readonly children: ReactNode;
}

/**
 * Root layout: Australian English, self-hosted Yantramanav through the `--font-sans` token, and the nonce'd inline
 * script that applies the stored theme before first paint (no flash, §12). Reading the request nonce makes every
 * page dynamic, which the per-request CSP requires.
 */
export default async function RootLayout({ children }: RootLayoutProps) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const fontStack = `${yantramanav.style.fontFamily}, "Segoe UI", system-ui, Helvetica, Arial, sans-serif`;
  return (
    <html lang="en-AU" style={{ "--font-sans": fontStack } as CSSProperties} suppressHydrationWarning>
      <head>
        <script nonce={nonce}>{THEME_BOOTSTRAP_SCRIPT}</script>
        {/* The canvas wash photo is only discovered once the CSS has loaded: fetch it from the HTML (AVIF, the format the
            stylesheet's image-set picks; the size follows the shell stylesheet's 760 px breakpoint). */}
        {HERO_PRELOADS.map((hero) => (
          <link key={hero.href} rel="preload" as="image" type="image/avif" fetchPriority="high" {...hero} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
