import "@kr/design-tokens/tokens.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KR Surveys Subdivision Tracker",
  description: "Keeping you up to date with your subdivision",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

interface RootLayoutProps {
  readonly children: ReactNode;
}

/** Root layout. The app shell (header, theme, session) is built in WP-09. */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
