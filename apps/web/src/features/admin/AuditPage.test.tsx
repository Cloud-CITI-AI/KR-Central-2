import { PROBLEM_TYPES } from "@kr/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { AuditPage } from "./AuditPage";
import { MFA_REQUIRED } from "./ProblemNotice";
import { syntheticAuditEvent, syntheticJobCard, syntheticUser } from "./test-fixtures";

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
  jobNumber: null,
  changes: null,
});
const jobA = syntheticJobCard("S-0001");

function respondWith(events: unknown[], nextCursor: string | null = null) {
  return mockApi("listAuditEvents", { items: events, nextCursor });
}
function renderPage(role: "admin" | "kr_admin" = "admin") {
  server.use(
    mockApi("listJobs", { items: [jobA], nextCursor: null }),
    mockApi("listUsers", { items: [syntheticUser()], nextCursor: null }),
  );
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
    const jobLink = one?.getByRole("link", { name: "Open job P-0001" });
    expect(jobLink).toHaveTextContent("P-0001");
    expect(jobLink).toHaveAttribute("href", `/jobs/${first.jobId}`);
    expect(jobLink?.className).toContain("link");
    expect(container).not.toHaveTextContent(String(first.jobId).slice(0, 8));
    expect(one?.getByText("address")).toBeInTheDocument();
    expect(two?.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("2 events")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("says when nothing matches", async () => {
    server.use(respondWith([]));
    renderPage();
    expect(await screen.findByText(/No events match/)).toBeInTheDocument();
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

describe("AuditPage filters", () => {
  it("filters by job number, user and action, sending ids and the action prefix to the API", async () => {
    const calls = recordAudit(() => ({ items: [first], nextCursor: null }));
    renderPage();
    await screen.findByText("job.updated");
    await userEvent.type(screen.getByRole("combobox", { name: "Job" }), "s-0001");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "User" }), "Ann Auditor");
    await userEvent.type(screen.getByRole("textbox", { name: "Action" }), "job.");
    await waitFor(() => {
      expect(calls.at(-1)?.get("jobId")).toBe(jobA.id);
      expect(calls.at(-1)?.get("actorId")).toBe(ann.id);
      expect(calls.at(-1)?.get("action")).toBe("job.");
    });
    expect(calls[0]?.has("jobId")).toBe(false);
  });

  it("asks for a job number from the list while the typed text names no job, and accepts a pasted job id", async () => {
    const calls = recordAudit((p) => ({ items: p.get("jobId") ? [] : [first], nextCursor: null }));
    renderPage();
    const job = await screen.findByRole("combobox", { name: "Job" });
    await screen.findByText("job.updated");
    const callsBefore = calls.length;
    await userEvent.type(job, "nope");
    expect(screen.getByText("Choose a job number from the list.")).toBeInTheDocument();
    // The unfiltered trail must not stand in for the job's events: no rows, no new request.
    expect(screen.getByText("Choose a job number from the list to see its events.")).toBeInTheDocument();
    expect(screen.queryByText("job.updated")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(calls).toHaveLength(callsBefore);
    await userEvent.clear(job);
    await userEvent.type(job, jobA.id);
    await waitFor(() => {
      expect(calls.at(-1)?.get("jobId")).toBe(jobA.id);
    });
    expect(screen.queryByText("Choose a job number from the list.")).toBeNull();
  });

  it("offers the users the admin can list, and for a KR admin only the people seen in the events", async () => {
    server.use(respondWith([first]));
    const { unmount } = renderPage("admin");
    const options = async () =>
      within(await screen.findByRole("combobox", { name: "User" }))
        .getAllByRole("option")
        .map((o) => o.textContent);
    await waitFor(async () => {
      expect((await options()).length).toBe(3);
    });
    unmount();
    const listUsers = vi.fn();
    server.use(
      respondWith([first]),
      handlerFor("listUsers", () => (listUsers(), HttpResponse.json({ items: [], nextCursor: null }))),
    );
    renderWithProviders(<AuditPage />, { me: syntheticMe("kr_admin") });
    await screen.findByText("job.updated");
    expect(await options()).toEqual(["All users", "Ann Auditor"]);
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe("AuditPage Perth date range", () => {
  const onTheDay = syntheticAuditEvent({ id: "5", occurredAt: "2026-09-28T15:59:00.000Z", action: "on.the.day" });
  const nextDayPerth = syntheticAuditEvent({
    id: "4",
    occurredAt: "2026-09-28T16:00:00.000Z",
    action: "next.day.perth",
  });
  const before = syntheticAuditEvent({ id: "3", occurredAt: "2026-09-27T15:59:00.000Z", action: "before.the.day" });
  const older = syntheticAuditEvent({ id: "2", occurredAt: "2026-09-20T00:00:00.000Z", action: "much.older" });

  it("keeps the events of the Perth day and pages back until the start of the range is passed", async () => {
    const calls = recordAudit((p) => {
      const cursor = p.get("cursor");
      if (!cursor) return { items: [nextDayPerth, onTheDay], nextCursor: "c2" };
      return cursor === "c2" ? { items: [before], nextCursor: "c3" } : { items: [older], nextCursor: null };
    });
    renderPage();
    await screen.findByText("next.day.perth");
    await userEvent.type(screen.getByLabelText("From (Perth date)"), "2026-09-28");
    await userEvent.type(screen.getByLabelText("To (Perth date)"), "2026-09-28");
    expect(await screen.findByText("on.the.day")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("next.day.perth")).toBeNull();
    });
    expect(screen.queryByText("before.the.day")).toBeNull();
    // `before` is older than the range start, so nothing older than it is fetched and the list is complete.
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(calls.map((p) => p.get("cursor"))).toEqual([null, "c2"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says no events match, without offering more, when the start of the range is already inside the first page", async () => {
    const calls = recordAudit(() => ({ items: [nextDayPerth, onTheDay, older], nextCursor: "c2" }));
    renderPage();
    await screen.findByText("next.day.perth");
    await userEvent.type(screen.getByLabelText("From (Perth date)"), "2026-09-25");
    await userEvent.type(screen.getByLabelText("To (Perth date)"), "2026-09-25");
    expect(await screen.findByText(/No events match/)).toBeInTheDocument();
    expect(screen.queryByText(/so far/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("pages back to the start date when only 'From' is set", async () => {
    recordAudit((p) =>
      p.get("cursor") ? { items: [onTheDay], nextCursor: null } : { items: [nextDayPerth], nextCursor: "c2" },
    );
    renderPage();
    await screen.findByText("next.day.perth");
    await userEvent.type(screen.getByLabelText("From (Perth date)"), "2026-09-28");
    expect(await screen.findByText("on.the.day")).toBeInTheDocument();
  });

  it("finds the first event before the end date when only 'To' is set", async () => {
    recordAudit((p) =>
      p.get("cursor") ? { items: [before], nextCursor: null } : { items: [nextDayPerth], nextCursor: "c2" },
    );
    renderPage();
    await screen.findByText("next.day.perth");
    await userEvent.type(screen.getByLabelText("To (Perth date)"), "2026-09-28");
    expect(await screen.findByText("before.the.day")).toBeInTheDocument();
  });

  it("sends no request when a start date is set while the Job text names no job", async () => {
    const calls = recordAudit(() => ({ items: [nextDayPerth], nextCursor: "c2" }));
    renderPage();
    await screen.findByText("next.day.perth");
    await userEvent.type(await screen.findByRole("combobox", { name: "Job" }), "nope");
    const callsBefore = calls.length;
    await userEvent.type(screen.getByLabelText("From (Perth date)"), "2026-09-28");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("Choose a job number from the list to see its events.")).toBeInTheDocument();
    expect(calls).toHaveLength(callsBefore);
  });

  it("warns when the end date is before the start date", async () => {
    server.use(respondWith([first]));
    renderPage();
    await screen.findByText("job.updated");
    await userEvent.type(screen.getByLabelText("From (Perth date)"), "2026-09-28");
    await userEvent.type(screen.getByLabelText("To (Perth date)"), "2026-09-01");
    expect(await screen.findByText("The end date is before the start date.")).toBeInTheDocument();
  });

  it("shows no matches and stops paging when the end date is before the start date", async () => {
    const calls = recordAudit(() => ({ items: [first], nextCursor: "next" }));
    renderPage();
    await screen.findByText("job.updated");
    act(() => {
      fireEvent.change(screen.getByLabelText("From (Perth date)"), { target: { value: "2026-09-28" } });
      fireEvent.change(screen.getByLabelText("To (Perth date)"), { target: { value: "2026-09-01" } });
    });
    expect(await screen.findByText(/No events match/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    // The start date alone pages back once (the oldest event is still on or after it); a backwards range stops there.
    const settled = calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBeLessThanOrEqual(2);
    expect(calls).toHaveLength(settled);
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
