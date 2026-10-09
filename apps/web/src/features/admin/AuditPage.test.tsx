import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { AuditPage } from "./AuditPage";
import { MFA_REQUIRED } from "./ProblemNotice";
import { syntheticAuditEvent } from "./test-fixtures";

const ann = { id: "7b0f3d52-6a38-4f6e-9d5e-1c2a4b9c8e01", displayName: "Ann Auditor" };
const first = syntheticAuditEvent({
  id: "3",
  actor: ann,
  action: "job.updated",
  changes: { address: { from: "A", to: "B" } },
});
const second = syntheticAuditEvent({
  id: "2",
  actor: null,
  actorType: "system",
  action: "user.created",
  jobId: null,
  changes: null,
});

function respondWith(events: unknown[], nextCursor: string | null = null) {
  return mockApi("listAuditEvents", { items: events, nextCursor });
}
function renderPage(role: "admin" | "kr_admin" = "admin") {
  return renderWithProviders(<AuditPage />, { me: syntheticMe(role) });
}
/** Records the query string of every listAuditEvents call. */
function recordAudit(answer: (params: URLSearchParams) => Record<string, unknown>) {
  const calls: URLSearchParams[] = [];
  server.use(
    handlerFor("listAuditEvents", ({ request }) => {
      const params = new URL(request.url).searchParams;
      calls.push(params);
      return HttpResponse.json(answer(params));
    }),
  );
  return calls;
}

describe("AuditPage list", () => {
  it("shows time, user, action, job, entity and changes, newest first as the API sends them", async () => {
    server.use(respondWith([first, second]));
    const { container } = renderPage();
    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(2);
    const [one, two] = rows.map((row) => within(row));
    expect(one?.getByText("28 Sep 2026, 11:50:56 am")).toBeInTheDocument();
    expect(one?.getByText("Ann Auditor")).toBeInTheDocument();
    expect(one?.getByText("job.updated")).toBeInTheDocument();
    expect(one?.getByRole("link", { name: `Open job ${first.jobId}` })).toHaveAttribute("href", `/jobs/${first.jobId}`);
    expect(one?.getByText("address")).toBeInTheDocument();
    expect(two?.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("says when nothing matches", async () => {
    server.use(respondWith([]));
    renderPage();
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument();
  });

  it("pages with the cursor", async () => {
    const calls = recordAudit((p) =>
      p.get("cursor") ? { items: [second], nextCursor: null } : { items: [first], nextCursor: "c2" },
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("user.created")).toBeInTheDocument();
    expect(calls.map((p) => p.get("cursor"))).toEqual([null, "c2"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("does not reload on a timer, so rows stay put while read", async () => {
    server.use(respondWith([first]));
    const { queryClient } = renderPage();
    await screen.findByText("job.updated");
    const query = queryClient.getQueryCache().findAll({ queryKey: ["audit"] })[0];
    expect(query?.observers[0]?.options.refetchInterval).toBe(false);
  });
});

describe("AuditPage problems", () => {
  it("shows the multi-factor 403 with its sign-out offer instead of the trail", async () => {
    server.use(mockProblem("listAuditEvents", 403, PROBLEM_TYPES.forbidden, { detail: MFA_REQUIRED }));
    const { container } = renderPage("kr_admin");
    expect(await screen.findByRole("alert")).toHaveTextContent(MFA_REQUIRED);
    expect(screen.getByRole("button", { name: "Sign out and sign in again" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("offers Try again when the trail cannot be loaded", async () => {
    server.use(mockProblem("listAuditEvents", 500));
    renderPage();
    await screen.findByRole("alert");
    server.use(respondWith([first]));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("job.updated")).toBeInTheDocument();
  });
});
