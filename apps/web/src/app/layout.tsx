import "@kr/design-tokens/tokens.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import { yantramanav } from "@/lib/fonts";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "KR Surveys Subdivision Tracker", template: "%s | KR Surveys Subdivision Tracker" },
  description: "Keeping you up to date with your subdivision",
};

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
      </head>
      <body>{children}</body>
    </html>
  );
}
