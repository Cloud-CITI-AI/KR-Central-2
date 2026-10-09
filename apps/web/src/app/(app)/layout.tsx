import type { ReactNode } from "react";

interface AppLayoutProps {
  readonly children: ReactNode;
}

/**
 * Authenticated area layout — STUB. WP-03 implements: session check (GET /v1/me server-side via the BFF),
 * redirect to /sign-in, QueryClientProvider, SessionProvider, AppHeader, Banner region and footer.
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return children;
}
