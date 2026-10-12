import type { Metadata } from "next";
import { Panel } from "@/components/ui/Panel";
import { safeReturnTo } from "@/lib/security/return-to";
import { SignInLink } from "./SignInLink";

export const metadata: Metadata = { title: "Sign in" };

interface SignInPageProps {
  readonly searchParams: Promise<{ readonly returnTo?: string | string[] }>;
}

/** Branded sign-in (§3.1): one button to the API's login redirect, keeping a same-origin returnTo (and the link's #fragment) only. */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { returnTo } = await searchParams;
  const safe = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  return (
    <Panel title="Sign in">
      <p>Sign in with your Microsoft account to see your subdivision jobs.</p>
      <p>
        <SignInLink returnTo={safe} />
      </p>
      <p>
        KR Surveys keeps the name and email address on your Microsoft account to show who made each change. Your
        Microsoft password is never shared with this site.
      </p>
    </Panel>
  );
}
