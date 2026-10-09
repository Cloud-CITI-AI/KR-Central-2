/** Access manager texts, exactly as PRODUCT_SPEC §6 / §3.4 where it gives them. Australian English. */
export const ACCESS_MESSAGES = {
  title: "Access manager",
  description:
    "Add the people who should be able to view a job – choose the job from the list. KR Surveys staff see all jobs automatically.",
  /** §3.4: without the flag, KR IT invites the guest in Entra and the UI says so. */
  invitationOff: "KR Surveys IT must also invite them as a guest in Microsoft Entra before they can sign in.",
  invitationOn: "They are sent a Microsoft Entra invitation email automatically.",
  scope: "Clients and architects only see the job you choose.",
  noJob: "Choose which job they should see.",
  loadFailed: "The access list couldn't be loaded. Reload the page and try again.",
  empty: "No one has been added yet.",
} as const;

export const ROLE_OPTIONS = [
  ["client", "Client – sees their own job"],
  ["architect", "Architect – sees their own job"],
] as const;

export function duplicateText(email: string, jobNumber: string): string {
  return `${email} is already on the list for ${jobNumber}.`;
}

/** "x@y.z added – …", with the invitation sentence when the flag is on and the invitation went out. */
export function addedText(email: string, invitationSent: boolean): string {
  const text = `${email} added – they get access when they sign in with that email.`;
  return invitationSent ? `${text} An invitation email has been sent.` : text;
}

export function saveFailedText(requestId: string | undefined): string {
  const text = "That couldn't be saved. Try again.";
  return requestId ? `${text} (Request ID: ${requestId})` : text;
}

export const ROLE_LABELS = { client: "Client", architect: "Architect" } as const;
export const STATUS_LABELS = { pending: "Pending", active: "Active", revoked: "Revoked" } as const;
