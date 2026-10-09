import { PROBLEM_TYPES } from "@kr/contracts";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { ApprovalDates } from "./ApprovalDates";
import { syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";

/** 12:00 in Perth on Fri 9 Oct 2026. */
const NOW = new Date("2026-10-09T04:00:00Z");

describe("ApprovalDates status under the expiry (§5.2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const show = (approvalExpiry: string | null) => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    return renderTracker(<ApprovalDates job={syntheticJob({ fields: { approvalExpiry } })} />);
  };

  it.each([
    ["2027-10-09", "366 days left to lodge Form 1C", "ok"],
    ["2026-10-10", "2 days left to lodge Form 1C", "soon"],
    ["2026-10-09", "1 day left to lodge Form 1C", "soon"],
    ["2026-10-06", "Expired 3 days ago", "past"],
    ["2026-10-08", "Expired 1 day ago", "past"],
  ])("expiry %s reads %s and is %s", (expiry, text, level) => {
    show(expiry);
    const status = screen.getByText(text);
    expect(screen.getByLabelText("Approval expiry")).toHaveAccessibleDescription(text);
    expect(status.className).toContain(level);
  });

  it("recounts every minute from the injected clock", () => {
    show("2026-10-10");
    expect(screen.getByText("2 days left to lodge Form 1C")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60_000);
    });
    expect(screen.getByText("1 day left to lodge Form 1C")).toBeInTheDocument();
  });

  it("shows no status without an expiry", () => {
    show(null);
    expect(document.querySelector("span[id]")).toBeNull();
  });
});

describe("ApprovalDates inputs", () => {
  it("is labelled, explains the empty state and has no axe violations", async () => {
    const { container } = renderTracker(<ApprovalDates job={syntheticJob()} />);
    expect(screen.getByLabelText("WAPC approval date")).toHaveValue("");
    expect(screen.getByLabelText("Approval expiry")).toHaveValue("");
    expect(
      screen.getByText("Filled in automatically when conditions are extracted from the Decision Letter in 5.0"),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows saved dates and drops the empty-state hint", () => {
    const job = syntheticJob({ fields: { approvalDate: "2026-03-16", approvalExpiry: "2028-03-16" } });
    renderTracker(<ApprovalDates job={job} />);
    expect(screen.getByLabelText("WAPC approval date")).toHaveValue("2026-03-16");
    expect(screen.queryByText(/Filled in automatically/)).toBeNull();
  });

  it("saves a picked date with If-Match, shows it at once and keeps it", async () => {
    const job = syntheticJob();
    const seen: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        return HttpResponse.json({ ...job, approvalExpiry: "2028-03-16", version: 2 });
      }),
    );
    const { queryClient } = renderTracker(<ApprovalDates job={job} />);
    queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    fireEvent.change(screen.getByLabelText("Approval expiry"), { target: { value: "2028-03-16" } });
    expect(screen.getByLabelText("Approval expiry")).toHaveValue("2028-03-16");
    await waitFor(() => {
      expect(seen).toEqual([{ ifMatch: '"1"', body: { approvalExpiry: "2028-03-16" } }]);
    });
  });

  it("clears a date with null", async () => {
    const job = syntheticJob({ fields: { approvalDate: "2026-03-16" } });
    const bodies: unknown[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...job, approvalDate: null, version: 2 });
      }),
    );
    const { queryClient } = renderTracker(<ApprovalDates job={job} />);
    queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    fireEvent.change(screen.getByLabelText("WAPC approval date"), { target: { value: "" } });
    await waitFor(() => {
      expect(bodies).toEqual([{ approvalDate: null }]);
    });
  });

  it("goes back to the saved date and shows the banner when the save fails", async () => {
    const job = syntheticJob({ fields: { approvalDate: "2026-03-16" } });
    server.use(mockProblem("updateJob", 500, PROBLEM_TYPES.internal));
    const { queryClient } = renderTracker(<ApprovalDates job={job} />);
    queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    fireEvent.change(screen.getByLabelText("WAPC approval date"), { target: { value: "2026-04-01" } });
    await waitFor(() => {
      expect(screen.getByLabelText("WAPC approval date")).toHaveValue("2026-03-16");
    });
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
  });

  it("is read-only without job.edit", () => {
    const job = syntheticJob({ role: "external", grantRole: "client", fields: { approvalDate: "2026-03-16" } });
    renderTracker(<ApprovalDates job={job} />);
    expect(screen.getByLabelText("WAPC approval date")).toBeDisabled();
    expect(screen.getByLabelText("Approval expiry")).toBeDisabled();
  });
});
