import type { ReactElement } from "react";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { mockApi } from "@/test/msw/handlers";
import { syntheticMe } from "@/test/fixtures";
import { server } from "@/test/msw/server";
import { renderWithProviders, type RenderWithProvidersOptions } from "@/test/render";

/** The `next/navigation` stand-in for tracker tests: a recording router and a throwing notFound(). */
export const router = { push: (_href: string): void => undefined };
export const NOT_FOUND = "NEXT_NOT_FOUND";
export const navigationMock = {
  useRouter: () => router,
  notFound: (): never => {
    throw new Error(NOT_FOUND);
  },
};

/** Render a tracker piece in the app providers with the banner region beside it; the session refresh gets its answer. */
export function renderTracker(ui: ReactElement, { me = syntheticMe(), ...options }: RenderWithProvidersOptions = {}) {
  server.use(mockApi("getMe", me));
  return renderWithProviders(
    <>
      <BannerRegion />
      {ui}
    </>,
    { me, ...options },
  );
}
