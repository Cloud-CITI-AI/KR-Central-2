import { PROBLEM_TYPES, UpdateUserRequest, type User } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ToastRegion } from "@/components/ui/ToastRegion";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { MFA_REQUIRED } from "./ProblemNotice";
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
  return renderWithProviders(
    <>
      <UsersPage />
      <ToastRegion />
    </>,
    { me },
  );
}
/** Answers updateUser with the user changed as asked, and records what was sent. */
function recordUpdates(user: User) {
  const sent: { userId: string; body: unknown }[] = [];
  server.use(
    handlerFor("updateUser", async ({ request, params }) => {
      const body = UpdateUserRequest.parse(await request.json());
      sent.push({ userId: String(params.userId), body });
      return HttpResponse.json({ ...user, ...body });
    }),
  );
  return sent;
}

describe("UsersPage list", () => {
  it("lists name, email, role, guest or member, status and last sign-in", async () => {
    server.use(show([own, sam, gus]));
    const { container } = renderPage();
    const row = (await screen.findByRole("cell", { name: "Sam Staff" })).closest("tr");
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement);
    expect(cells.getByText("sam@example.com")).toBeInTheDocument();
    expect(cells.getByRole("combobox", { name: "Role for Sam Staff" })).toHaveValue("staff");
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

  it("makes the signed-in admin's own row read-only", async () => {
    server.use(show([own, sam]));
    renderPage();
    const row = within((await screen.findByText("(you)")).closest("tr") as HTMLElement);
    expect(row.queryByRole("combobox")).toBeNull();
    expect(row.queryByRole("button")).toBeNull();
    expect(row.getByText("Admin")).toBeInTheDocument();
    expect(row.getByText("Your own role and status can't be changed.")).toBeInTheDocument();
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
    expect(await screen.findByText("No users match.")).toBeInTheDocument();
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

describe("UsersPage changes", () => {
  it("changes a role only after the admin confirms", async () => {
    server.use(show([own, sam]));
    const sent = recordUpdates(sam);
    renderPage();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Role for Sam Staff" }), "kr_admin");
    const dialog = screen.getByRole("dialog", { name: "Change role" });
    expect(dialog).toHaveTextContent("Change Sam Staff from Staff to KR Admin?");
    expect(sent).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Change role" }));
    await waitFor(() => {
      expect(sent).toEqual([{ userId: sam.id, body: { role: "kr_admin" } }]);
    });
    expect(await screen.findByText("Sam Staff updated.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("changes nothing when the admin cancels", async () => {
    server.use(show([sam]));
    const sent = recordUpdates(sam);
    renderPage();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Role for Sam Staff" }), "admin");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Role for Sam Staff" })).toHaveValue("staff");
    expect(sent).toEqual([]);
  });

  it("disables an active user and enables a disabled one after confirming", async () => {
    server.use(show([sam, gus]));
    const sent = recordUpdates(sam);
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Disable Sam Staff" }));
    expect(screen.getByRole("dialog", { name: "Disable user" })).toHaveTextContent("signed out now");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disable" }));
    await waitFor(() => {
      expect(sent).toEqual([{ userId: sam.id, body: { status: "disabled" } }]);
    });
    await userEvent.click(screen.getByRole("button", { name: "Enable Gus Guest" }));
    expect(screen.getByRole("dialog", { name: "Enable user" })).toHaveTextContent("They can sign in again.");
  });
});

describe("UsersPage problems", () => {
  it("shows the last-admin 409 and keeps the list", async () => {
    server.use(
      show([own, sam]),
      mockProblem("updateUser", 409, PROBLEM_TYPES.conflict, { detail: "There must be at least one active admin." }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Disable Sam Staff" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There must be at least one active admin.");
    expect(screen.getByText("Sam Staff")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the 412 text and reloads the list", async () => {
    const load = vi.fn();
    server.use(
      handlerFor("listUsers", () => {
        load();
        return HttpResponse.json({ items: [sam], nextCursor: null });
      }),
      mockProblem("updateUser", 412, PROBLEM_TYPES.preconditionFailed),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Disable Sam Staff" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this");
    await waitFor(() => {
      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  it("replaces the list with the multi-factor problem and its sign-out offer", async () => {
    server.use(mockProblem("listUsers", 403, PROBLEM_TYPES.forbidden, { detail: MFA_REQUIRED }));
    const { container } = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(MFA_REQUIRED);
    expect(screen.getByRole("button", { name: "Sign out and sign in again" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("offers Try again when the list cannot be loaded, and loads it when it can", async () => {
    server.use(mockProblem("listUsers", 500));
    renderPage();
    await screen.findByRole("alert");
    server.use(show([sam]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Sam Staff")).toBeInTheDocument();
  });
});
