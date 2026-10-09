"use client";
import { useBanners } from "@/lib/banner/BannerProvider";
import { Banner } from "./Banner";

/** The live region for page banners: always mounted so screen readers announce what is added (§12). */
export function BannerRegion() {
  const { banners, dismiss } = useBanners();
  return (
    <div aria-live="polite">
      {banners.map((banner) => (
        <Banner
          key={banner.id}
          onDismiss={() => {
            dismiss(banner.id);
          }}
        >
          {banner.text}
        </Banner>
      ))}
    </div>
  );
}
