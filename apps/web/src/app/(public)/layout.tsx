import type { ReactNode } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { Footer } from "@/components/ui/Footer";
import { Wrap } from "@/components/ui/Wrap";
import { getFeedbackUrl } from "@/env";

interface PublicLayoutProps {
  readonly children: ReactNode;
}

/** Pages without a session (sign-in, sign-in error, signed out): the hero header and one panel. */
export default function PublicLayout({ children }: PublicLayoutProps) {
  const feedbackUrl = getFeedbackUrl();
  return (
    <>
      <AppHeader />
      <Wrap as="main" spaced>
        {children}
      </Wrap>
      <Footer {...(feedbackUrl ? { feedbackUrl } : {})} />
    </>
  );
}
