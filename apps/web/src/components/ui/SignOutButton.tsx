"use client";
import { useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useBanners } from "@/lib/banner/BannerProvider";
import { MESSAGES } from "@/lib/messages";
import { navigation } from "@/lib/navigation";
import { Button } from "./Button";

/** Sign out: POST logout (revokes the session, clears the cookie), then go to Entra's end-session URL (§3.1). */
export function SignOutButton() {
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

  return (
    <Button
      variant="photo"
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
