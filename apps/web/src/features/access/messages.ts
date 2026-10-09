/** Access manager texts, exactly as PRODUCT_SPEC §6 / §3.4 where it gives them. Australian English. */
export const ACCESS_MESSAGES = {
  title: "Access manager",
  description:
    "Add the people who should be able to view a job – choose the job from the list. KR Surveys staff see all jobs automatically.",
  /** §3.4: without the flag, KR IT invites the guest in Entra and the UI says so. */
  invitationOff: "KR Surveys IT must also invite them as a guest in Microsoft Entra before they can sign in.",
  invitationOn: "They are sent a Microsoft Entra invitation email automatically.",
} as const;
