import { describe, expect, it } from "vitest";
import { INVITATION_ERROR_MAX, InvitationError, invitationErrorText } from "./guest-inviter.js";

describe("invitationErrorText", () => {
  it("keeps the message of an InvitationError", () => {
    expect(invitationErrorText(new InvitationError("Graph answered 403 (Authorization_RequestDenied)."))).toBe(
      "Graph answered 403 (Authorization_RequestDenied).",
    );
  });
  it("hides anything else behind a generic line", () => {
    expect(invitationErrorText(new TypeError("fetch failed: secret-token-123"))).toBe(
      "The invitation could not be sent.",
    );
    expect(invitationErrorText("boom")).toBe("The invitation could not be sent.");
  });
  it("fits the invitation_error column", () => {
    expect(invitationErrorText(new InvitationError("x".repeat(900)))).toHaveLength(INVITATION_ERROR_MAX);
  });
});
