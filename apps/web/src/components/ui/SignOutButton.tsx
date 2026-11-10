"use client";
import { useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { navigation } from "@/lib/navigation";
import { Icons } from "@/components/shell/icons";
import styles from "@/components/shell/Shell.module.css";
import { Button } from "./Button";

export interface SignOutButtonProps {
  /** Icon-only form for the sidebar's user block (the label stays for assistive tech). */
  readonly compact?: boolean;
}

/** Sign out: POST logout (revokes the session, clears the cookie), then go to Entra's end-session URL (§3.1). */
export function SignOutButton({ compact = false }: SignOutButtonProps = {}) {
  const { show } = useBanners();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const { redirectTo } = await api("logout");
      navigation.assign(redirectTo);
    } catch (error) {
      setBusy(false);
      const requestId = error instanceof ApiProblem && error.requestId ? ` (Request ID: ${error.requestId})` : "";
      show("sign-out-failed", `${MESSAGES.signOutFailed}${requestId}`);
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        className={styles.tool}
        aria-label="Sign out"
        title="Sign out"
        disabled={busy}
        onClick={() => {
          void signOut();
        }}
      >
        <Icons.logout width={16} height={16} />
      </button>
    );
  }
  return (
    <Button
      small
      disabled={busy}
      onClick={() => {
        void signOut();
      }}
    >
      Sign out
    </Button>
  );
}
