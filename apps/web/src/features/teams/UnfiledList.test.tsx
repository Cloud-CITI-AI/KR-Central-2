import { FileTeamsUnfiledRequest, type TeamsUnfiledItem } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { UnfiledList, filingChoices, problemText } from "./UnfiledList";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const item = (o: Partial<TeamsUnfiledItem> & { itemId: string; name: string }): TeamsUnfiledItem => ({
  path: "",
  sizeBytes: 2048,
  addedBy: "Sam Surveyor",
  modifiedAt: "2026-11-06T00:00:00.000Z",
  seenAt: "2026-11-06T00:01:00.000Z",
  problem: null,
  ...o,
});
const conditions = [{ id: "c1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", number: 3 }];

describe("UnfiledList", () => {
  it("lists items with where they sit, who added them, a filing choice and FILE / DISMISS, flagging ones it cannot import", async () => {
    server.use(
      mockApi("listTeamsUnfiled", {
        items: [
          item({ itemId: "01A", name: "notes.pdf" }),
          item({ itemId: "01B", name: "huge.mp4", path: "02 WAPC Approval", problem: "too_large" }),
        ],
        uploadMaxBytes: 52_428_800,
      }),
    );
    const { container } = renderWithProviders(<UnfiledList jobId={JOB} canFile conditions={conditions} />, {
      me: syntheticMe("staff"),
    });
    expect(
      await screen.findByRole("heading", { name: "Files added in Teams that need filing (2)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("02 WAPC Approval/huge.mp4")).toBeInTheDocument();
    expect(screen.getByText("Too large (limit 50 MB)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "File" })).toHaveLength(1);
    expect(screen.getAllByText(/added by Sam Surveyor/)).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it("files an item into the chosen slot or condition and dismisses another", async () => {
    server.use(
      mockApi("listTeamsUnfiled", {
        items: [item({ itemId: "01A", name: "notes.pdf" }), item({ itemId: "01B", name: "photo.png" })],
        uploadMaxBytes: 1,
      }),
    );
    const filed: unknown[] = [];
    const dismissed: string[] = [];
    server.use(
      handlerFor("fileTeamsUnfiled", async ({ request, params }) => {
        filed.push({ itemId: params.itemId, body: FileTeamsUnfiledRequest.parse(await request.json()) });
        return HttpResponse.json({ operationId: "7d444840-9dc0-41b4-a5c2-3a8e7f1d2b9c" }, { status: 202 });
      }),
      handlerFor("dismissTeamsUnfiled", ({ params }) => {
        dismissed.push(String(params.itemId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <UnfiledList jobId={JOB} canFile conditions={conditions} />
        <ToastRegion />
      </>,
      { me: syntheticMe("staff") },
    );
    const row = (await screen.findByText("notes.pdf")).closest("li") as HTMLElement;
    const fileButton = within(row).getByRole("button", { name: "File" });
    expect(fileButton).toBeDisabled();
    await user.selectOptions(within(row).getByRole("combobox"), "cp:i2_0:survey");
    await user.click(fileButton);
    await waitFor(() => {
      expect(filed).toHaveLength(1);
    });
    expect(filed[0]).toEqual({ itemId: "01A", body: { checkpointKey: "i2_0", slot: "survey" } });
    expect(await screen.findByText(/Filing the file/)).toBeInTheDocument();
    const other = (await screen.findByText("photo.png")).closest("li") as HTMLElement;
    await user.selectOptions(within(other).getByRole("combobox"), `cond:${conditions[0]?.id}`);
    await user.click(within(other).getByRole("button", { name: "File" }));
    await waitFor(() => {
      expect(filed).toHaveLength(2);
    });
    expect(filed[1]).toEqual({ itemId: "01B", body: { conditionId: conditions[0]?.id } });
    await user.click(within(other).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      expect(dismissed).toEqual(["01B"]);
    });
  });

  it("renders nothing when the list is empty, and no controls without upload rights", async () => {
    server.use(mockApi("listTeamsUnfiled", { items: [], uploadMaxBytes: 1 }));
    const empty = renderWithProviders(<UnfiledList jobId={JOB} canFile conditions={[]} />, {
      me: syntheticMe("staff"),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("heading")).toBeNull();
    empty.unmount();
    server.use(mockApi("listTeamsUnfiled", { items: [item({ itemId: "01A", name: "notes.pdf" })], uploadMaxBytes: 1 }));
    renderWithProviders(<UnfiledList jobId={JOB} canFile={false} conditions={[]} />, { me: syntheticMe("staff") });
    expect(await screen.findByText("notes.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("filingChoices and problemText", () => {
  it("offers every non-fee checkpoint slot and each condition, and names problems", () => {
    const choices = filingChoices(conditions);
    expect(choices.some((c) => c.value === "cp:i2_0:survey")).toBe(true);
    expect(choices.some((c) => c.value.startsWith("cp:i1_0p"))).toBe(false);
    expect(choices.at(-1)).toEqual({ value: `cond:${conditions[0]?.id}`, label: "Condition 3 evidence" });
    expect(problemText(item({ itemId: "x", name: "x", problem: "malware" }), 1)).toBe(
      "Blocked: malware found in a file added in Teams",
    );
    expect(problemText(item({ itemId: "x", name: "x" }), 1)).toBeNull();
  });
});
