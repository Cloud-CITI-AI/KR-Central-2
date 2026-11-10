import type { Me } from "@kr/contracts";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/AppProviders";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { formatMegabytes } from "@/lib/format";
import { getFeedbackUrl } from "@/env";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import styles from "./Shell.module.css";

export interface AppShellProps {
  readonly me: Me;
  readonly children: ReactNode;
}

/**
 * The signed-in frame of KR Central (§4): the photo-washed canvas, the floating sidebar, the breadcrumb strip,
 * banners, the page, toasts and a one-line footer. A server component; the sidebar and strip are client islands.
 */
export function AppShell({ me, children }: AppShellProps) {
  const feedbackUrl = getFeedbackUrl();
  return (
    <AppProviders me={me}>
      <div className={styles.canvas}>
        <Sidebar />
        <div className={styles.page}>
          <TopBar />
          <main className={styles.main}>
            <BannerRegion />
            {children}
          </main>
          <footer className={styles.footer}>
            <span>KR Surveys</span>
            <span>
              Files accepted: PDF, images, video and text/CSV up to {formatMegabytes(me.uploadMaxBytes)} MB each
            </span>
            {feedbackUrl && (
              <a href={feedbackUrl} target="_blank" rel="noopener noreferrer">
                Send feedback
              </a>
            )}
          </footer>
        </div>
      </div>
      <ToastRegion />
    </AppProviders>
  );
}
