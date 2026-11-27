/** Exact texts of the Teams panel, link dialog and unlink confirm (PRODUCT_SPEC §5.10). */
export const TEAMS_MESSAGES = {
  title: "Teams channel",
  syncOff: "Teams sync is turned off. An admin can turn it on under Admin → Teams.",
  notLinked: "This job is not linked to a Teams channel.",
  settingUp: "Setting up folders in Teams…",
  openInTeams: "Open in Teams",
  nothingCopied: "Nothing copied yet",
  lastCopied: (when: string) => `Last copied ${when}`,
  counts: (c: { pushed: number; pending: number; failed: number; excluded: number }) =>
    `Files copied to Teams: ${c.pushed} · waiting: ${c.pending} · failed: ${c.failed} · not copied: ${c.excluded}`,
  error: (reason: string) => `Teams link needs attention: ${reason}`,
  reasons: {
    channel_folder_missing: "the channel's folder was not found (private, shared or deleted channel?)",
    permission_denied: "the app is not allowed to write to this team's site (ask KR IT to check the site grant)",
    channel_name_taken: "a channel with this name already exists",
    graph_unavailable: "Teams did not answer",
    teams_not_configured: "the Teams settings are incomplete (check Admin → Teams)",
  } as Readonly<Record<string, string>>,
  notCreated: "Channel not created: Teams did not answer. Create it from the panel.",
  notCreatedTaken: "Channel not created: a channel with this name already exists. Link an existing channel instead.",
  feeNote: "Fee proposal files are never copied to the job channel.",
  feeFolder: "Open fee proposal folder",
  nameNote: "Channel name is not updated when the job changes.",
  link: "Link channel",
  relink: "Relink",
  unlink: "Unlink",
  create: "Create channel",
  dialog: {
    title: "Link Teams channel",
    field: "Channel link",
    hint: "In Teams, open the channel, choose Get link to channel, and paste it here.",
    pasteInstead: "Paste a channel link instead",
    picker: "Channel",
    pickOne: "Choose a channel.",
    invalid: "That is not a Teams channel link.",
    confirm: "Link",
    cancel: "Cancel",
  },
  unlinkConfirm: {
    title: "Unlink Teams channel",
    text: "Unlink this job from its Teams channel? Files already copied stay in Teams. New files will not be copied.",
    confirm: "Unlink",
    cancel: "Cancel",
  },
  unfiledTitle: (n: number) => `Files added in Teams that need filing (${n})`,
  badges: {
    pushed: "In Teams",
    pending: "Waiting to copy",
    failed: "Not copied",
    removed: "Removed in Teams",
    changed: "Changed in Teams; not removed there",
  },
} as const;

/** The reason text for an error code: the spec's wording for known codes, the code itself otherwise. */
export function errorReason(code: string | null): string {
  if (!code) return TEAMS_MESSAGES.reasons.graph_unavailable ?? "";
  return TEAMS_MESSAGES.reasons[code] ?? code.replaceAll("_", " ");
}

/** Client-side shape check of a pasted link before the API sees it (the API is authoritative). */
export function looksLikeChannelLink(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return (
      url.protocol === "https:" &&
      (url.hostname === "teams.microsoft.com" || url.hostname === "teams.cloud.microsoft") &&
      url.pathname.startsWith("/l/channel/")
    );
  } catch {
    return false;
  }
}
