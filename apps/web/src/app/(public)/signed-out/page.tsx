import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Panel } from "@/components/ui/Panel";

export const metadata: Metadata = { title: "Signed out" };

/** Where Entra's end-session redirect lands (`post_logout_redirect_uri`, §3.1). */
export default function SignedOutPage() {
  return (
    <Panel title="You have signed out">
      <p>
        <ButtonLink href="/sign-in" variant="primary">
          Sign in
        </ButtonLink>
      </p>
    </Panel>
  );
}
