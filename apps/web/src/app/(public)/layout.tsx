import type { ReactNode } from "react";
import { PublicShell } from "@/components/shell/PublicShell";
import { getFeedbackUrl } from "@/env";

interface PublicLayoutProps {
  readonly children: ReactNode;
}

/** Pages without a session (sign-in, sign-in error, signed out): the KR Central public frame and one card. */
export default function PublicLayout({ children }: PublicLayoutProps) {
  return <PublicShell feedbackUrl={getFeedbackUrl()}>{children}</PublicShell>;
}
