import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Panel } from "@/components/ui/Panel";
import { signInErrorMessage } from "@/lib/auth-errors";

export const metadata: Metadata = { title: "Sign-in problem" };

interface SignInErrorPageProps {
  readonly searchParams: Promise<{ readonly reason?: string | string[] }>;
}

/** Friendly sign-in failure: one text per `reason` code (§3.1 step 7) and "Try again". */
export default async function SignInErrorPage({ searchParams }: SignInErrorPageProps) {
  const { reason } = await searchParams;
  return (
    <Panel title="Sign-in problem">
      <p>{signInErrorMessage(typeof reason === "string" ? reason : undefined)}</p>
      <p>
        <ButtonLink href="/sign-in" variant="primary">
          Try again
        </ButtonLink>
      </p>
    </Panel>
  );
}
