import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PublicCard } from "@/components/shell/PublicShell";

export const metadata: Metadata = { title: "Signed out" };

/** Where Entra's end-session redirect lands (`post_logout_redirect_uri`, §3.1). */
export default function SignedOutPage() {
  return (
    <PublicCard title="You have signed out">
      <p>
        <ButtonLink href="/sign-in" variant="primary">
          Sign in
        </ButtonLink>
      </p>
    </PublicCard>
  );
}
