import { describe, expect, it } from "vitest";
import { SIGN_IN_ERRORS, signInErrorMessage } from "./auth-errors";

describe("signInErrorMessage", () => {
  it.each(Object.entries(SIGN_IN_ERRORS))("%s has its own text", (reason, text) => {
    expect(signInErrorMessage(reason)).toBe(text);
  });

  it("covers exactly the §3.1 reason codes with the spec's wording", () => {
    expect(Object.keys(SIGN_IN_ERRORS)).toEqual([
      "cancelled",
      "wrong_tenant",
      "disabled",
      "expired",
      "unverified_email",
      "failed",
    ]);
    expect(SIGN_IN_ERRORS.wrong_tenant).toBe(
      "That account isn't part of the KR Surveys organisation – sign in with the account KR Surveys invited.",
    );
  });

  it("reads anything else (missing, unknown, prototype keys) as failed", () => {
    for (const reason of [undefined, "", "nope", "constructor", "__proto__"]) {
      expect(signInErrorMessage(reason)).toBe("Sign-in didn't work – please try again.");
    }
  });
});
