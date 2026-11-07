import { PROBLEM_TYPES, UpdateTeamsSettingsRequest, type TeamsSettings } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { CHECK_LABELS, TEXTS, TeamsSettingsPage, formFrom, saveNotes } from "./TeamsSettingsPage";

const TEAM = "11111111-2222-4333-8444-555555555555";
const features = { aiStampReading: false, guestInvites: false, malwareScanning: true, teamsFileSync: true };
const admin = syntheticMe("admin", { features });
const krAdmin = syntheticMe("kr_admin", { features });

function stored(overrides: Partial<TeamsSettings> = {}): TeamsSettings {
  return {
    teamId: null,
    teamSiteUrl: null,
    teamName: null,
    feeChannelId: null,
    feeChannelLink: null,
    feeSiteUrl: null,
    rootFolder: "102. Subdivision Tracker",
    feeProposalPolicy: "exclude",
    syncEnabled: false,
    inboundSyncEnabled: false,
    createChannelsEnabled: false,
    inboundPollSeconds: 300,
    updatedBy: null,
    updatedAt: "2026-11-06T00:00:00.000Z",
    version: 1,
    lastCheck: null,
    ...overrides,
  };
}

function renderPage(me = admin) {
  return renderWithProviders(
    <>
      <TeamsSettingsPage />
      <ToastRegion />
    </>,
    { me },
  );
}

describe("TeamsSettingsPage", () => {
  it("shows the stored settings in the form with no accessibility violations", async () => {
    server.use(mockApi("getTeamsSettings", stored({ teamId: TEAM, teamName: "Team Survey", syncEnabled: true })));
    const { container } = renderPage();
    expect(await screen.findByLabelText("Team id")).toHaveValue(TEAM);
    expect(screen.getByLabelText("Team name")).toHaveValue("Team Survey");
    expect(screen.getByRole("checkbox", { name: "Copy files to Teams" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Create channels for new jobs" })).toBeDisabled();
    await expectNoAxeViolations(container);
  });

  it("saves with If-Match, shows the §9.3 notes and the field error the API sends back", async () => {
    server.use(mockApi("getTeamsSettings", stored({ teamId: TEAM, syncEnabled: true, version: 3 })));
    const sent: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      handlerFor("updateTeamsSettings", async ({ request }) => {
        const body = UpdateTeamsSettingsRequest.parse(await request.json());
        sent.push({ ifMatch: request.headers.get("if-match"), body });
        return HttpResponse.json(
          stored({ ...body, feeChannelId: null, version: 4, updatedAt: "2026-11-06T01:00:00.000Z" }),
        );
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const sync = await screen.findByRole("checkbox", { name: "Copy files to Teams" });
    await user.click(sync);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.ifMatch).toBe('"3"');
    expect(sent[0]?.body).toMatchObject({ syncEnabled: false, teamId: TEAM });
    expect(await screen.findByText(TEXTS.saved)).toBeInTheDocument();
    expect(screen.getByText(TEXTS.syncOff)).toBeInTheDocument();

    server.use(
      mockProblem("updateTeamsSettings", 400, PROBLEM_TYPES.invalidChannelLink, {
        detail: "That is not a Teams channel link.",
        errors: [{ path: "feeChannelLink", message: "That is not a Teams channel link." }],
      }),
    );
    await user.type(screen.getByLabelText("Fee Proposals channel link"), "nonsense");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findAllByText("That is not a Teams channel link.")).not.toHaveLength(0);
    expect(screen.getByLabelText("Fee Proposals channel link")).toHaveAttribute("aria-invalid", "true");
  });

  it("runs Test connection and lists each check with its label and code", async () => {
    server.use(
      mockApi("getTeamsSettings", stored({ teamId: TEAM, syncEnabled: true })),
      mockApi("checkTeamsConnection", { operationId: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c" }, 202),
      mockApi("getOperation", {
        id: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c",
        jobId: null,
        type: "teams.check",
        status: "succeeded",
        createdAt: "2026-11-06T00:00:00.000Z",
        completedAt: "2026-11-06T00:00:05.000Z",
        result: {
          results: [
            { item: "token", ok: true, errorCode: null },
            { item: "team_site", ok: true, errorCode: null },
            { item: "team_site_write", ok: false, errorCode: "403 accessDenied" },
          ],
          skipped: ["fee_site"],
        },
        error: null,
      }),
    );
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole("button", { name: "Test connection" }));
    const list = await screen.findByRole("region", { name: "Test connection results" });
    expect(list).toHaveTextContent(CHECK_LABELS.token ?? "");
    expect(list).toHaveTextContent("Can write to the team site");
    expect(list).toHaveTextContent("403 accessDenied");
    expect(list).toHaveTextContent("Fee Proposals site found");
    await expectNoAxeViolations(container);
  });

  it("is read-only for kr_admin", async () => {
    server.use(mockApi("getTeamsSettings", stored()));
    renderPage(krAdmin);
    expect(await screen.findByText(/only an admin can change them/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByLabelText("Team id")).toBeDisabled();
  });
});

describe("saveNotes and formFrom", () => {
  it("notes a changed team only when one was set before, and copying turned off", () => {
    const before = stored({ teamId: TEAM, syncEnabled: true });
    expect(saveNotes(before, stored({ teamId: TEAM, syncEnabled: true }))).toEqual([TEXTS.saved]);
    expect(saveNotes(stored(), stored({ teamId: TEAM }))).toEqual([TEXTS.saved]);
    expect(saveNotes(before, stored({ teamId: "22222222-2222-4222-8222-222222222222", syncEnabled: true }))).toEqual([
      TEXTS.saved,
      TEXTS.teamChanged,
    ]);
    expect(saveNotes(before, stored({ teamId: TEAM }))).toEqual([TEXTS.saved, TEXTS.syncOff]);
  });
  it("fills the form from the stored row", () => {
    expect(
      formFrom(stored({ teamId: TEAM, feeChannelLink: "https://teams.microsoft.com/l/channel/x/y" })),
    ).toMatchObject({
      teamId: TEAM,
      feeChannelLink: "https://teams.microsoft.com/l/channel/x/y",
      inboundPollSeconds: 300,
    });
  });
});
