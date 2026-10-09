import { describe, expect, it } from "vitest";
import { reasonForExchangeError } from "./oidc-errors.js";

const claimError = (claim: string) =>
  Object.assign(new Error("unexpected JWT claim value encountered"), {
    code: "OAUTH_JWT_CLAIM_COMPARISON_FAILED",
    cause: { cause: { claim } },
  });

describe("reasonForExchangeError", () => {
  it("reads a token issued by another directory (iss differs) as wrong_tenant", () => {
    expect(reasonForExchangeError(claimError("iss"))).toBe("wrong_tenant");
  });

  it.each([claimError("aud"), claimError("nonce"), new Error("boom"), new TypeError("x"), null, undefined, "text"])(
    "reads every other failure as failed (%s)",
    (err) => {
      expect(reasonForExchangeError(err)).toBe("failed");
    },
  );
});
