import { jobCapabilitiesFor, LinkTeamsChannelRequest, PROBLEM_TYPES, type TeamsLink } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { TEAMS_MESSAGES as M, looksLikeChannelLink } from "./messages";
import { TeamsPanel } from "./TeamsPanel";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const features = { aiStampReading: false, guestInvites: false, malwareScanning: true, teamsFileSync: true };
const admin = syntheticMe("admin", { features });
const staff = syntheticMe("staff", { features });
const TEAMS_URL = "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/S-0042?groupId=a&tenantId=b";
const CHANNEL_LINK =
  "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/S-0042?groupId=11111111-2222-4333-8444-555555555555&tenantId=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function link(overrides: Partial<TeamsLink> = {}): TeamsLink {
  return {
    jobId: JOB,
    state: "not_linked",
    channelName: null,
    teamsUrl: null,
    sharePointUrl: null,
    linkedBy: null,
    linkedAt: null,
    lastPushAt: null,
    counts: { pushed: 0, pending: 0, failed: 0, excluded: 0, unfiled: 0 },
    errorCode: null,
    operationId: null,
    feeProposalPolicy: "exclude",
    feeProposalFolderUrl: null,
    canLink: true,
    version: null,
    lastPollAt: null,
    inboundSyncEnabled: false,
    createEnabled: false,
    ...overrides,
  };
}
const ready = link({
  state: "ready",
  channelName: "S-0042_1 EXAMPLE RD, SUBURB (CLIENT)",
  teamsUrl: TEAMS_URL,
  counts: { pushed: 7, pending: 1, failed: 0, excluded: 2, unfiled: 0 },
  lastPushAt: "2026-11-06T01:02:00.000Z",
  version: 1,
});

function renderPanel(me = admin, role: "admin" | "staff" = "admin") {
  return renderWithProviders(
    <>
      <TeamsPanel jobId={JOB} capabilities={jobCapabilitiesFor(role, null)} />
      <ToastRegion />
    </>,
    { me },
  );
}

describe("TeamsPanel", () => {
  it("is hidden when the integration is off for the deployment, for externals, and when the API answers 404", async () => {
    server.use(mockApi("getJobTeamsLink", ready));
    const off = renderWithProviders(<TeamsPanel jobId={JOB} capabilities={jobCapabilitiesFor("admin", null)} />, {
      me: syntheticMe("admin"),
    });
    expect(screen.queryByRole("heading", { name: "Teams channel" })).toBeNull();
    off.unmount();
    const client = renderWithProviders(
      <TeamsPanel jobId={JOB} capabilities={jobCapabilitiesFor("external", "client")} />,
      { me: syntheticMe("external", { features }) },
    );
    expect(screen.queryByRole("heading", { name: "Teams channel" })).toBeNull();
    client.unmount();
    server.use(mockProblem("getJobTeamsLink", 404, PROBLEM_TYPES.notFound));
    renderPanel();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("heading", { name: "Teams channel" })).toBeNull();
  });

  it("shows the sync-off text to admins with no buttons, and the not-linked state with LINK CHANNEL", async () => {
    server.use(mockApi("getJobTeamsLink", link({ state: "sync_off" })));
    const off = renderPanel();
    expect(await screen.findByText(M.syncOff)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    off.unmount();
    server.use(mockApi("getJobTeamsLink", link()));
    const { container } = renderPanel();
    expect(await screen.findByText(M.notLinked)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link channel" })).toBeInTheDocument();
    expect(screen.getByText(M.feeNote)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows a linked channel with Open in Teams (new tab, noopener), the counts, the last copy time and UNLINK", async () => {
    server.use(mockApi("getJobTeamsLink", ready));
    const { container } = renderPanel();
    expect(await screen.findByText(/S-0042_1 EXAMPLE RD/)).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open in Teams" });
    expect(open).toHaveAttribute("href", TEAMS_URL);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("Files copied to Teams: 7 · waiting: 1 · failed: 0 · not copied: 2")).toBeInTheDocument();
    expect(screen.getByText(/^Last copied /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link channel" })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("is read-only for staff, and shows the error state with the spec's reason and RELINK for admins", async () => {
    server.use(mockApi("getJobTeamsLink", { ...ready, canLink: false }));
    const s = renderPanel(staff, "staff");
    expect(await screen.findByText(/S-0042_1 EXAMPLE RD/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    s.unmount();
    server.use(mockApi("getJobTeamsLink", { ...ready, state: "error", errorCode: "channel_folder_missing" }));
    const { container } = renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Teams link needs attention: the channel's folder was not found (private, shared or deleted channel?)",
    );
    expect(screen.getByRole("button", { name: "Relink" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("links a channel from the dialog, shows the setting-up state, and surfaces the API's problem text inline", async () => {
    server.use(mockApi("getJobTeamsLink", link()));
    const sent: unknown[] = [];
    server.use(
      handlerFor("linkJobTeamsChannel", async ({ request }) => {
        const body = LinkTeamsChannelRequest.parse(await request.json());
        sent.push(body);
        return HttpResponse.json(
          link({
            state: "provisioning",
            channelName: "S-0042",
            teamsUrl: TEAMS_URL,
            version: 1,
            operationId: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c",
          }),
          { status: 202 },
        );
      }),
    );
    const user = userEvent.setup();
    const { container } = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Link channel" }));
    const dialog = screen.getByRole("dialog", { name: "Link Teams channel" });
    expect(within(dialog).getByText(M.dialog.hint)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Channel link"), "not a link");
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(M.dialog.invalid);
    expect(sent).toHaveLength(0);
    await expectNoAxeViolations(container);

    await user.clear(within(dialog).getByLabelText("Channel link"));
    await user.type(within(dialog).getByLabelText("Channel link"), CHANNEL_LINK);
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]).toEqual({ channelLink: CHANNEL_LINK });
    expect(await screen.findByText("Setting up folders in Teams…")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Link Teams channel" })).toBeNull();

    server.use(mockApi("getJobTeamsLink", link()));
    server.use(
      mockProblem("linkJobTeamsChannel", 409, PROBLEM_TYPES.channelAlreadyLinked, {
        detail: "That channel is already linked to job S-0001.",
      }),
    );
  });

  it("explains a channel already linked to another job, and unlinks after a confirm", async () => {
    server.use(mockApi("getJobTeamsLink", link()));
    server.use(
      mockProblem("linkJobTeamsChannel", 409, PROBLEM_TYPES.channelAlreadyLinked, {
        detail: "That channel is already linked to job S-0001.",
      }),
    );
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Link channel" }));
    const dialog = screen.getByRole("dialog", { name: "Link Teams channel" });
    await user.type(within(dialog).getByLabelText("Channel link"), CHANNEL_LINK);
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That channel is already linked to job S-0001.");
    first.unmount();

    server.use(mockApi("getJobTeamsLink", ready));
    let unlinked = 0;
    server.use(
      handlerFor("unlinkJobTeamsChannel", () => {
        unlinked += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Unlink" }));
    const confirm = screen.getByRole("dialog", { name: "Unlink Teams channel" });
    expect(within(confirm).getByText(M.unlinkConfirm.text)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(unlinked).toBe(0);
    await user.click(screen.getByRole("button", { name: "Unlink" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Unlink Teams channel" })).getByRole("button", { name: "Unlink" }),
    );
    await waitFor(() => {
      expect(unlinked).toBe(1);
    });
    expect(await screen.findByText("Unlinked from Teams.")).toBeInTheDocument();
  });
});

describe("TeamsPanel phase 3", () => {
  const channels = {
    channels: [
      { channelId: "19:gen@thread.tacv2", displayName: "General" },
      { channelId: "19:job@thread.tacv2", displayName: "S-0042_1 EXAMPLE RD" },
    ],
    cachedAt: "2026-11-06T00:00:00.000Z",
    channelName: null,
    nameTaken: false,
    createEnabled: true,
    teamId: "11111111-2222-4333-8444-555555555555",
    tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  };

  it("offers CREATE CHANNEL when creation is on, shows the not-created reasons, and queues creation", async () => {
    server.use(mockApi("getJobTeamsLink", link({ createEnabled: true })), mockApi("listTeamsChannels", channels));
    let created = 0;
    server.use(
      handlerFor("createJobTeamsChannel", () => {
        created += 1;
        return HttpResponse.json({ operationId: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c" }, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    const first = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Create channel" }));
    await waitFor(() => {
      expect(created).toBe(1);
    });
    first.unmount();
    server.use(
      mockApi("getJobTeamsLink", link({ state: "not_created", errorCode: "channel_name_taken", createEnabled: true })),
    );
    const { container } = renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(M.notCreatedTaken);
    expect(screen.getByRole("button", { name: "Link channel" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("links from the picker with a link built from the chosen channel, and falls back to pasting", async () => {
    server.use(mockApi("getJobTeamsLink", link()), mockApi("listTeamsChannels", channels));
    const sent: unknown[] = [];
    server.use(
      handlerFor("linkJobTeamsChannel", async ({ request }) => {
        sent.push(LinkTeamsChannelRequest.parse(await request.json()));
        return HttpResponse.json(link({ state: "provisioning", channelName: "S-0042_1 EXAMPLE RD", version: 1 }), {
          status: 202,
        });
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Link channel" }));
    const dialog = screen.getByRole("dialog", { name: "Link Teams channel" });
    const picker = await within(dialog).findByRole("combobox", { name: "Channel" });
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(M.dialog.pickOne);
    await user.selectOptions(picker, "19:job@thread.tacv2");
    await user.click(within(dialog).getByRole("button", { name: "Link" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]).toEqual({
      channelLink: `https://teams.microsoft.com/l/channel/19%3Ajob%40thread.tacv2/S-0042_1%20EXAMPLE%20RD?groupId=${channels.teamId}&tenantId=${channels.tenantId}`,
    });
  });

  it("shows the paste field when the cache is empty, or after choosing to paste", async () => {
    server.use(mockApi("getJobTeamsLink", link()), mockApi("listTeamsChannels", { ...channels, channels: [] }));
    const user = userEvent.setup();
    const empty = renderPanel();
    await user.click(await screen.findByRole("button", { name: "Link channel" }));
    expect(await screen.findByLabelText("Channel link")).toBeInTheDocument();
    empty.unmount();
    server.use(mockApi("listTeamsChannels", channels));
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "Link channel" }));
    const dialog = screen.getByRole("dialog", { name: "Link Teams channel" });
    await within(dialog).findByRole("combobox", { name: "Channel" });
    await user.click(within(dialog).getByRole("button", { name: M.dialog.pasteInstead }));
    expect(within(dialog).getByLabelText("Channel link")).toBeInTheDocument();
  });
});

describe("looksLikeChannelLink", () => {
  it("accepts both Teams hosts and refuses anything else", () => {
    expect(looksLikeChannelLink(CHANNEL_LINK)).toBe(true);
    expect(looksLikeChannelLink(CHANNEL_LINK.replace("teams.microsoft.com", "teams.cloud.microsoft"))).toBe(true);
    expect(looksLikeChannelLink("https://example.test/l/channel/x")).toBe(false);
    expect(looksLikeChannelLink("General")).toBe(false);
  });
});
