"use client";
import { useSyncExternalStore } from "react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { loginHref } from "./login-href";

export interface SignInLinkProps {
  /** The `returnTo` the page was opened with, already checked as a same-origin path. */
  readonly returnTo: string | undefined;
}

const subscribeHash = (notify: () => void) => {
  window.addEventListener("hashchange", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
  };
};
const readHash = () => window.location.hash;

/**
 * "Sign in with Microsoft". A deep link such as `/jobs/<id>#checkpoint-i13_2` reaches sign-in with its `#fragment` outside
 * `returnTo` (the browser keeps it across the redirect, no server ever sees it): it is added to `returnTo` here so sign-in
 * lands on the same card (PRODUCT_SPEC §3.1, §4).
 */
export function SignInLink({ returnTo }: SignInLinkProps) {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  return (
    <ButtonLink href={loginHref(returnTo, hash)} variant="primary">
      Sign in with Microsoft
    </ButtonLink>
  );
}
