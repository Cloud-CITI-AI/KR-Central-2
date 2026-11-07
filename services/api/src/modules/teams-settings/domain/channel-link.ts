/**
 * The pasted "Get link to channel" URL, parsed without fetching it (ADR-0015 decision 4). Pure.
 *
 * Accepted shape: https://teams.microsoft.com/l/channel/{channelId}/{channelName}?groupId={team}&tenantId={tenant}
 * (also host teams.cloud.microsoft, the new Teams client). The channel id is `19:…@thread.tacv2` or `…@thread.skype`,
 * URL-encoded in the path. Anything else is `invalid`; a channel of another team or tenant is reported so the API can
 * answer the right problem type. The returned `teamsUrl` is rebuilt from the parsed parts, never the pasted text.
 */
export const CHANNEL_ID_PATTERN = /^19:[^/]+@thread\.(tacv2|skype)$/;
const HOSTS = new Set(["teams.microsoft.com", "teams.cloud.microsoft"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Teams channel names are at most 50 characters; the links table enforces the same bound. */
export const CHANNEL_NAME_MAX = 50;

export interface ParsedChannelLink {
  readonly channelId: string;
  readonly channelName: string;
  readonly groupId: string;
  readonly tenantId: string;
  /** Canonical teams.microsoft.com link for Open in Teams. */
  readonly teamsUrl: string;
}

export type ChannelLinkResult = { readonly ok: true; readonly link: ParsedChannelLink } | { readonly ok: false };

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** A channel name as the link carries it: decoded, trimmed, control characters removed, capped (A11). */
function cleanName(raw: string): string {
  let text = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) text += ch;
  }
  text = text.trim();
  return text.length > CHANNEL_NAME_MAX ? text.slice(0, CHANNEL_NAME_MAX) : text;
}

export function buildTeamsUrl(link: Omit<ParsedChannelLink, "teamsUrl">): string {
  const params = new URLSearchParams({ groupId: link.groupId.toLowerCase(), tenantId: link.tenantId.toLowerCase() });
  return `https://teams.microsoft.com/l/channel/${encodeURIComponent(link.channelId)}/${encodeURIComponent(link.channelName)}?${params.toString()}`;
}

export function parseChannelLink(text: string): ChannelLinkResult {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false };
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase())) return { ok: false };
  const parts = url.pathname.split("/").filter((p) => p.length > 0);
  if (parts.length < 3 || parts[0] !== "l" || parts[1] !== "channel") return { ok: false };
  const channelId = decode(parts[2] ?? "");
  if (channelId === null || !CHANNEL_ID_PATTERN.test(channelId)) return { ok: false };
  const channelName = cleanName(decode(parts[3] ?? "") ?? "");
  if (channelName.length === 0) return { ok: false };
  const groupId = url.searchParams.get("groupId") ?? "";
  const tenantId = url.searchParams.get("tenantId") ?? "";
  if (!UUID.test(groupId) || !UUID.test(tenantId)) return { ok: false };
  const base = { channelId, channelName, groupId: groupId.toLowerCase(), tenantId: tenantId.toLowerCase() };
  return { ok: true, link: { ...base, teamsUrl: buildTeamsUrl(base) } };
}

export type ChannelLinkCheck = "ok" | "wrong_team" | "wrong_tenant";

/** Whether a parsed link belongs to the configured team (`teamId`, from the settings) and the KR tenant. */
export function checkChannelLink(
  link: Pick<ParsedChannelLink, "groupId" | "tenantId">,
  expected: { readonly teamId: string | null; readonly tenantId: string },
): ChannelLinkCheck {
  if (link.tenantId !== expected.tenantId.toLowerCase()) return "wrong_tenant";
  if (link.groupId !== expected.teamId?.toLowerCase()) return "wrong_team";
  return "ok";
}
