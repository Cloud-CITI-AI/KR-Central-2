import type { Me } from "@kr/contracts";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/AppProviders";
import { getFeedbackUrl } from "@/env";
import { AppHeader } from "./AppHeader";
import { BannerRegion } from "./BannerRegion";
import { Footer } from "./Footer";
import { HeaderAccount } from "./HeaderAccount";
import { ToastRegion } from "./ToastRegion";
import { Wrap } from "./Wrap";

export interface SignedInShellProps {
  readonly me: Me;
  readonly children: ReactNode;
}

/** The signed-in page frame (§4): hero header with the account controls, banners, `<main>`, toasts and the footer. */
export function SignedInShell({ me, children }: SignedInShellProps) {
  const feedbackUrl = getFeedbackUrl();
  return (
    <AppProviders me={me}>
      <AppHeader controls={<HeaderAccount />} />
      <Wrap as="main">
        <BannerRegion />
        {children}
      </Wrap>
      <ToastRegion />
      <Footer maxUploadBytes={me.uploadMaxBytes} {...(feedbackUrl ? { feedbackUrl } : {})} />
    </AppProviders>
  );
}
