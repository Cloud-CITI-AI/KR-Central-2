import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { GrantList } from "./GrantList";
import { syntheticGrant } from "./test-fixtures";

const rowTexts = () => screen.getAllByRole("listitem").map((row) => row.textContent);

describe("GrantList", () => {
  it("says so when no one has been added", async () => {
    server.use(mockApi("listAccessGrants", { items: [], nextCursor: null }));
    renderWithProviders(<GrantList />);
    expect(await screen.findByText("No one has been added yet.")).toBeInTheDocument();
  });

  it("lists by job then email with role, status, invitation chips and the bound account name", async () => {
    server.use(
      mockApi("listAccessGrants", {
        items: [
          syntheticGrant({ jobNumber: "S-0010", email: "z@example.com", role: "architect", status: "revoked" }),
          syntheticGrant({
            jobNumber: "S-0002",
            email: "b@example.com",
            displayName: "Bea Bound",
            status: "active",
            invitationStatus: "sent",
          }),
          syntheticGrant({
            jobNumber: "S-0002",
            email: "a@example.com",
            displayName: "Al Typed",
            invitationStatus: "failed",
          }),
          syntheticGrant({ jobNumber: "S-0002", email: "c@example.com", status: "active" }),
        ],
        nextCursor: null,
      }),
    );
    const { container } = renderWithProviders(<GrantList />);
    await screen.findAllByRole("listitem");
    expect(rowTexts()).toEqual([
      "Al Typed <a@example.com>S-0002ClientPendingInvitation failed",
      "b@example.comS-0002ClientActiveInvitation sentSigned in as Bea Bound",
      "c@example.comS-0002ClientActiveSigned in",
      "z@example.comS-0010ArchitectRevoked",
    ]);
    await expectNoAxeViolations(container);
  });

  it("loads the next page on request", async () => {
    server.use(
      handlerFor("listAccessGrants", ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.get("cursor")
            ? { items: [syntheticGrant({ email: "second@example.com" })], nextCursor: null }
            : { items: [syntheticGrant({ email: "first@example.com" })], nextCursor: "p2" },
        ),
      ),
    );
    renderWithProviders(<GrantList />);
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    const list = await screen.findAllByRole("listitem");
    expect(list).toHaveLength(2);
    expect(within(screen.getByRole("list")).getByText("second@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("shows a problem text with the request id when the list cannot be loaded", async () => {
    server.use(mockProblem("listAccessGrants", 500, PROBLEM_TYPES.internal, { requestId: "req-list-1" }));
    renderWithProviders(<GrantList />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The access list couldn't be loaded. Reload the page and try again. (Request ID: req-list-1)",
    );
  });
});
