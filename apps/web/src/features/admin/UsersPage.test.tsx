import type { User } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { syntheticUser } from "./test-fixtures";
import { UsersPage } from "./UsersPage";

const me = syntheticMe("admin");
const own = syntheticUser({ ...me.user, role: "admin" });
const sam = syntheticUser({ displayName: "Sam Staff", email: "sam@example.com", role: "staff" });
const gus = syntheticUser({
  displayName: "Gus Guest",
  isGuest: true,
  role: "external",
  status: "disabled",
  lastSignInAt: null,
});

function show(items: readonly User[], nextCursor: string | null = null) {
  return mockApi("listUsers", { items, nextCursor });
}
function renderPage() {
  return renderWithProviders(<UsersPage />, { me });
}
describe("UsersPage list", () => {
  it("lists name, email, role, guest or member, status and last sign-in", async () => {
    server.use(show([own, sam, gus]));
    const { container } = renderPage();
    const row = (await screen.findByRole("cell", { name: "Sam Staff" })).closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("sam@example.com")).toBeInTheDocument();
    expect(cells.getByText("Staff")).toBeInTheDocument();
    expect(cells.getByText("Member")).toBeInTheDocument();
    expect(cells.getByText("Active")).toBeInTheDocument();
    expect(cells.getByText("28 Sep 2026, 11:50 am")).toBeInTheDocument();
    const guest = within(screen.getByRole("cell", { name: "Gus Guest" }).closest("tr") as HTMLElement);
    expect(guest.getByText("Guest")).toBeInTheDocument();
    expect(guest.getByText("Disabled")).toBeInTheDocument();
    expect(guest.getByText("Never")).toBeInTheDocument();
    expect(screen.getByText("3 users")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("searches by name or email and filters by role, sending both to the API", async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      handlerFor("listUsers", ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [sam], nextCursor: null });
      }),
    );
    renderPage();
    await screen.findByText("Sam Staff");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search users" }), "sam");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter by role" }), "staff");
    await waitFor(() => {
      expect(seen.at(-1)?.get("q")).toBe("sam");
      expect(seen.at(-1)?.get("role")).toBe("staff");
    });
    expect(seen[0]?.has("q")).toBe(false);
  });

  it("says when no one matches", async () => {
    server.use(show([]));
    renderPage();
    expect(await screen.findByText(/No users match/)).toBeInTheDocument();
  });

  it("loads the next page with the cursor", async () => {
    const cursors: (string | null)[] = [];
    server.use(
      handlerFor("listUsers", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(cursor ? { items: [gus], nextCursor: null } : { items: [sam], nextCursor: "c2" });
      }),
    );
    renderPage();
    expect(await screen.findByText("1 user so far")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Gus Guest")).toBeInTheDocument();
    expect(cursors).toEqual([null, "c2"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
