/**
 * Entra B2B guest invitations (ADR-0014): a port the access module calls when the `entra-guest-invites` flag is on.
 * The Microsoft Graph adapter is data/graph-inviter.ts; tests use the fake in ../testing.ts. An invitation that fails
 * never fails the grant: the failure is recorded on the grant (invitation_status/invitation_error).
 */
export interface GuestInvitation {
  readonly email: string;
  readonly displayName: string | null;
  /** Where the guest lands after redeeming the invitation: the app. */
  readonly redirectUrl: string;
}

export interface GuestInviter {
  /** Resolves when the invitation was accepted by Graph; rejects with any Error (preferably an InvitationError). */
  invite(invitation: GuestInvitation): Promise<void>;
}

/** An error whose message is safe to store on the grant and show to staff (no tokens, secrets or response bodies). */
export class InvitationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InvitationError";
  }
}

export const INVITATION_ERROR_MAX = 500;

/** The text stored in `invitation_error`: the message of an InvitationError, otherwise a generic line. */
export function invitationErrorText(error: unknown): string {
  const text = error instanceof InvitationError ? error.message : "The invitation could not be sent.";
  return text.slice(0, INVITATION_ERROR_MAX);
}
