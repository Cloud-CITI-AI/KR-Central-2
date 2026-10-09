import type { ReactNode } from "react";
import { AppProviders } from "@/components/AppProviders";
import { AppHeader } from "@/components/ui/AppHeader";
import { HeaderAccount } from "@/components/ui/HeaderAccount";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { Footer } from "@/components/ui/Footer";
import { Wrap } from "@/components/ui/Wrap";
import { getFeedbackUrl } from "@/env";
import { getMe } from "@/lib/session/get-me";

interface AppLayoutProps {
  readonly children: ReactNode;
}

/** Authenticated area: needs a session (401 redirects to sign-in), then hero header, banners, page and footer. */
export default async function AppLayout({ children }: AppLayoutProps) {
  const me = await getMe();
  const feedbackUrl = getFeedbackUrl();
  return (
    <AppProviders me={me}>
      <AppHeader controls={<HeaderAccount />} />
      <Wrap as="main">
        <BannerRegion />
        {children}
      </Wrap>
      <Footer maxUploadBytes={me.uploadMaxBytes} {...(feedbackUrl ? { feedbackUrl } : {})} />
    </AppProviders>
  );
}
