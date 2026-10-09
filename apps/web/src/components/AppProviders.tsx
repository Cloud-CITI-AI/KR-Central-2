"use client";
import type { Me } from "@kr/contracts";
import type { ReactNode } from "react";
import { ViewerProvider } from "@/features/viewer";
import { BannerProvider } from "@/lib/banner/BannerProvider";
import { QueryProvider } from "@/lib/query/QueryProvider";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast/ToastProvider";

export interface AppProvidersProps {
  readonly me: Me;
  readonly children: ReactNode;
}

/** Client providers of the authenticated area: queries, session, banners, toasts and the document viewer (WP-17). */
export function AppProviders({ me, children }: AppProvidersProps) {
  return (
    <QueryProvider>
      <SessionProvider me={me}>
        <BannerProvider>
          <ToastProvider>
            <ViewerProvider>{children}</ViewerProvider>
          </ToastProvider>
        </BannerProvider>
      </SessionProvider>
    </QueryProvider>
  );
}
