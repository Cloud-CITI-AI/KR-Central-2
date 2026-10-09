import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Panel } from "@/components/ui/Panel";
import { safeReturnTo } from "@/lib/security/return-to";

export const metadata: Metadata = { title: "Sign in" };

interface SignInPageProps {
  readonly searchParams: Promise<{ readonly returnTo?: string | string[] }>;
}

/** Branded sign-in (§3.1): one button to the API's login redirect, keeping a same-origin returnTo only. */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams;
  const safe = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  const href = `/api/v1/auth/login${safe ? `?returnTo=${encodeURIComponent(safe)}` : ""}`;
  return (
    <Panel title="Sign in">
      <p>Sign in with your Microsoft account to see your subdivision jobs.</p>
      <p>
        <ButtonLink href={href} variant="primary">
          Sign in with Microsoft
        </ButtonLink>
      </p>
      <p>
        KR Surveys keeps the name and email address on your Microsoft account to show who made each change. Your
        Microsoft password is never shared with this site.
      </p>
    </Panel>
  );
}
