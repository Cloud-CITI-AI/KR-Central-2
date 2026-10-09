import type { Me } from "@kr/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { BannerProvider } from "@/lib/banner/BannerProvider";
import { SessionProvider } from "@/lib/session";
import { ToastProvider } from "@/lib/toast/ToastProvider";
import { syntheticMe } from "./fixtures";

/** No retries and no background refetching: tests drive time themselves. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  readonly me?: Me;
  readonly queryClient?: QueryClient;
}

/** Render inside the app's providers: QueryClient, SessionProvider (synthetic Me) and banners. */
export function renderWithProviders(
  ui: ReactElement,
  { me = syntheticMe(), queryClient = createTestQueryClient(), ...options }: RenderWithProvidersOptions = {},
): RenderResult & { readonly me: Me; readonly queryClient: QueryClient } {
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider me={me}>
          <BannerProvider>
            <ToastProvider>{children}</ToastProvider>
          </BannerProvider>
        </SessionProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Wrapper, ...options }), me, queryClient };
}
