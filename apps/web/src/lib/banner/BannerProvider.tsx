"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface BannerMessage {
  readonly id: string;
  readonly text: string;
}

export interface BannerApi {
  readonly banners: readonly BannerMessage[];
  /** Show (or replace, by id) a banner under the header. */
  show(id: string, text: string): void;
  dismiss(id: string): void;
}

const BannerContext = createContext<BannerApi | null>(null);

export interface BannerProviderProps {
  readonly children: ReactNode;
}

/** Page-level banners (§5.1): read-only access, save failures, stale data. Rendered by `<BannerRegion>`. */
export function BannerProvider({ children }: BannerProviderProps) {
  const [banners, setBanners] = useState<readonly BannerMessage[]>([]);
  const show = useCallback((id: string, text: string) => {
    setBanners((current) => [...current.filter((b) => b.id !== id), { id, text }]);
  }, []);
  const dismiss = useCallback((id: string) => {
    setBanners((current) => current.filter((b) => b.id !== id));
  }, []);
  const value = useMemo(() => ({ banners, show, dismiss }), [banners, show, dismiss]);
  return <BannerContext value={value}>{children}</BannerContext>;
}

export function useBanners(): BannerApi {
  const api = useContext(BannerContext);
  if (!api) throw new Error("useBanners must be used inside <BannerProvider>");
  return api;
}
