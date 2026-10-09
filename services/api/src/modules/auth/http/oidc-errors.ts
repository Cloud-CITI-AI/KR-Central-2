/** What a failed code exchange means for the user: another directory's token, or a plain failure. */
import type { SignInReason } from "../domain/reasons.js";

const JWT_CLAIM_COMPARISON = "OAUTH_JWT_CLAIM_COMPARISON_FAILED";

/** openid-client wraps oauth4webapi's `OperationProcessingError`, whose `cause.claim` names the claim that differed. */
function failedClaim(err: unknown): string | undefined {
  const inner = (err as { cause?: { cause?: { claim?: unknown } } } | null)?.cause?.cause;
  return typeof inner?.claim === "string" ? inner.claim : undefined;
}

/** A token whose `iss` is not this tenant's v2.0 issuer comes from another directory; every other failure is `failed`. */
export function reasonForExchangeError(err: unknown): Extract<SignInReason, "failed" | "wrong_tenant"> {
  const code = (err as { code?: unknown } | null)?.code;
  return code === JWT_CLAIM_COMPARISON && failedClaim(err) === "iss" ? "wrong_tenant" : "failed";
}
