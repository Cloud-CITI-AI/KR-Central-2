import type { ReactElement } from "react";
import { BannerRegion } from "@/components/ui/BannerRegion";
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

export function renderTracker(ui: ReactElement, options: RenderWithProvidersOptions = {}) {
  return renderWithProviders(
    <>
      <BannerRegion />
      {ui}
    </>,
    options,
  );
}
