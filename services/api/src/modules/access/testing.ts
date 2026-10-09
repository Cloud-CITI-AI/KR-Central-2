/** Test support for the access module: a GuestInviter that records invitations and can be told to fail. Never in the build. */
import type { GuestInvitation, GuestInviter } from "./domain/guest-inviter.js";

export interface FakeGuestInviter extends GuestInviter {
  readonly invitations: GuestInvitation[];
  /** The next invite() rejects with this error (once). */
  failNextWith(error: unknown): void;
}

export function createFakeGuestInviter(): FakeGuestInviter {
  const invitations: GuestInvitation[] = [];
  let failure: { error: unknown } | null = null;
  return {
    invitations,
    failNextWith(error) {
      failure = { error };
    },
    invite(invitation) {
      invitations.push(invitation);
      if (failure) {
        const { error } = failure;
        failure = null;
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.resolve();
    },
  };
}
