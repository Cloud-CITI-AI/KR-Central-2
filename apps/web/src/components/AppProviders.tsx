"use client";
import type { Me } from "@kr/contracts";
import type { ReactNode } from "react";
import { ViewerProvider } from "@/features/viewer";
import { BannerProvider } from "@/lib/banner/BannerProvider";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { SessionProvider } from "@/lib/session";

export interface AppProvidersProps {
  readonly me: Me;
  readonly children: ReactNode;
}

/** Client providers of the authenticated area: queries, session, banners and the document viewer (WP-17). */
export function AppProviders({ me, children }: AppProvidersProps) {
  return (
    <QueryProvider>
      <SessionProvider me={me}>
        <BannerProvider>
          <ViewerProvider>{children}</ViewerProvider>
        </BannerProvider>
      </SessionProvider>
    </QueryProvider>
  );
}
