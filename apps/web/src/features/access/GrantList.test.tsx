import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
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
      "Al Typed <a@example.com>S-0002ClientPendingInvitation failedRemove a@example.com×",
      "b@example.comS-0002ClientActiveInvitation sentSigned in as Bea BoundRemove b@example.com×",
      "c@example.comS-0002ClientActiveSigned inRemove c@example.com×",
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

describe("GrantList revoke", () => {
  const listOf = (...grants: ReturnType<typeof syntheticGrant>[]) =>
    mockApi("listAccessGrants", { items: grants, nextCursor: null });

  it("asks Remove? Yes/No with focus on No, and No keeps the person", async () => {
    server.use(listOf(syntheticGrant({ email: "a@example.com" })));
    renderWithProviders(<GrantList />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove a@example.com" }));
    expect(screen.getByText("Remove?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByText("Remove?")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove a@example.com" })).toHaveFocus();
  });

  it("revokes on Yes: the row turns Revoked at once and the list is reloaded", async () => {
    const grant = syntheticGrant({ email: "a@example.com", status: "active" });
    let revoked: string | undefined;
    let lists = 0;
    server.use(
      handlerFor("listAccessGrants", () => {
        lists += 1;
        return HttpResponse.json({ items: [revoked ? { ...grant, status: "revoked" } : grant], nextCursor: null });
      }),
      handlerFor("revokeAccessGrant", ({ params }) => {
        revoked = String(params.grantId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<GrantList />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove a@example.com" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    expect(revoked).toBe(grant.id);
    await waitFor(() => {
      expect(lists).toBe(2);
    });
    expect(screen.queryByRole("button", { name: "Remove a@example.com" })).toBeNull();
  });

  it("puts the row back and says so when the API refuses", async () => {
    server.use(
      listOf(syntheticGrant({ email: "a@example.com" })),
      mockProblem("revokeAccessGrant", 500, PROBLEM_TYPES.internal),
    );
    renderWithProviders(<GrantList />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove a@example.com" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That couldn't be removed. Try again.");
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove a@example.com" })).toBeInTheDocument();
  });

  it("offers no remove button on a revoked grant", async () => {
    server.use(listOf(syntheticGrant({ email: "a@example.com", status: "revoked" })));
    renderWithProviders(<GrantList />);
    await screen.findByText("Revoked");
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
