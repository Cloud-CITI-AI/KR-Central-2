import { describe, expect, it } from "vitest";
import { checkChannelLink, parseChannelLink } from "./channel-link.js";

const TEAM = "11111111-2222-4333-8444-555555555555";
const TENANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ID = "19:2d0b1a7c4e5f4f0a9b8c7d6e5f4a3b2c@thread.tacv2";
const EID = encodeURIComponent(ID);
const link = (name = "General", host = "teams.microsoft.com") =>
  `https://${host}/l/channel/${EID}/${encodeURIComponent(name)}?groupId=${TEAM}&tenantId=${TENANT}`;

describe("parseChannelLink", () => {
  it("parses a classic link and rebuilds a canonical teams.microsoft.com URL", () => {
    const r = parseChannelLink(link("S-0042_1 EXAMPLE RD, SUBURB (CLIENT)"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.link).toEqual({
      channelId: ID,
      channelName: "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)",
      groupId: TEAM,
      tenantId: TENANT,
      teamsUrl: `https://teams.microsoft.com/l/channel/${EID}/S-0042_1%20EXAMPLE%20RD%2C%20SUBURB%20(CLIENT)?groupId=${TEAM}&tenantId=${TENANT}`,
    });
  });

  it("accepts the new Teams host, upper-case ids, surrounding whitespace and @thread.skype channels", () => {
    expect(parseChannelLink(`  ${link("General", "teams.cloud.microsoft")}  `).ok).toBe(true);
    const upper = link().replace(TEAM, TEAM.toUpperCase()).replace(TENANT, TENANT.toUpperCase());
    const r = parseChannelLink(upper);
    expect(r.ok && r.link.groupId).toBe(TEAM);
    const skype = `https://teams.microsoft.com/l/channel/19%3Aabc%40thread.skype/Old?groupId=${TEAM}&tenantId=${TENANT}`;
    expect(parseChannelLink(skype).ok).toBe(true);
  });

  it.each([
    ["not a URL", "General channel"],
    ["http", link().replace("https://", "http://")],
    ["another host", link("General", "teams.example.test")],
    [
      "a team link, not a channel",
      `https://teams.microsoft.com/l/team/${EID}/conversations?groupId=${TEAM}&tenantId=${TENANT}`,
    ],
    ["a bad channel id", `https://teams.microsoft.com/l/channel/abc/General?groupId=${TEAM}&tenantId=${TENANT}`],
    [
      "a channel id with a slash",
      `https://teams.microsoft.com/l/channel/19%3Aa%2Fb%40thread.tacv2/General?groupId=${TEAM}&tenantId=${TENANT}`,
    ],
    ["no groupId", `https://teams.microsoft.com/l/channel/${EID}/General?tenantId=${TENANT}`],
    [
      "a groupId that is not a uuid",
      `https://teams.microsoft.com/l/channel/${EID}/General?groupId=team&tenantId=${TENANT}`,
    ],
    ["no channel name", `https://teams.microsoft.com/l/channel/${EID}/?groupId=${TEAM}&tenantId=${TENANT}`],
    ["an undecodable name", `https://teams.microsoft.com/l/channel/${EID}/%E0%A4%A?groupId=${TEAM}&tenantId=${TENANT}`],
  ])("rejects %s", (_name, text) => {
    expect(parseChannelLink(text)).toEqual({ ok: false });
  });

  it("strips control characters from the name and caps it at 50 characters", () => {
    const r = parseChannelLink(link(`A\u0000B${"x".repeat(80)}`));
    expect(r.ok && r.link.channelName).toBe(`AB${"x".repeat(48)}`);
  });
});

describe("checkChannelLink", () => {
  const parsed = { groupId: TEAM, tenantId: TENANT };
  const other = "00000000-0000-4000-8000-000000000000";
  it("accepts the configured team in the KR tenant, case-insensitively", () => {
    expect(checkChannelLink(parsed, { teamId: TEAM.toUpperCase(), tenantId: TENANT.toUpperCase() })).toBe("ok");
  });
  it("reports another tenant before another team, and no configured team as wrong_team", () => {
    expect(checkChannelLink(parsed, { teamId: other, tenantId: other })).toBe("wrong_tenant");
    expect(checkChannelLink(parsed, { teamId: other, tenantId: TENANT })).toBe("wrong_team");
    expect(checkChannelLink(parsed, { teamId: null, tenantId: TENANT })).toBe("wrong_team");
  });
});
