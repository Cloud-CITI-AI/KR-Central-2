/** Sign-in failure texts, one per `reason` code (PRODUCT_SPEC §3.1 step 7). Unknown codes read as `failed`. */
export const SIGN_IN_ERRORS = {
  cancelled: "Sign-in was cancelled.",
  wrong_tenant: "That account isn't part of the KR Surveys organisation – sign in with the account KR Surveys invited.",
  disabled: "Your account has been disabled – contact KR Surveys.",
  expired: "That sign-in attempt expired or was started in another browser – please try again.",
  unverified_email: "We couldn't confirm your email address – ask your KR Surveys contact.",
  failed: "Sign-in didn't work – please try again.",
} as const;

export function signInErrorMessage(reason: string | undefined): string {
  return reason !== undefined && Object.hasOwn(SIGN_IN_ERRORS, reason)
    ? SIGN_IN_ERRORS[reason as keyof typeof SIGN_IN_ERRORS]
    : SIGN_IN_ERRORS.failed;
}
