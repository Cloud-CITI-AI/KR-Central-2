import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { HttpResponse } from "msw";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { Jobbar } from "./Jobbar";
import { jobPage, syntheticCard, syntheticJob } from "./test-fixtures";
import { renderTracker, router } from "./test-utils";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

describe("Jobbar", () => {
  beforeEach(() => {
    vi.spyOn(router, "push").mockImplementation(() => undefined);
  });

  it("lists the jobs grouped In progress / Complete, selects the open job and opens another on change", async () => {
    const job = syntheticJob({ fields: { jobNumber: "S-0002", address: "2 Example Rd", clientName: null } });
    const other = syntheticJob({ fields: { jobNumber: "S-0001", address: "1 Example Rd", clientName: null } });
    const done = syntheticJob({ fields: { jobNumber: "S-0003", address: "3 Example Rd", clientName: null } });
    server.use(mockApi("listJobs", jobPage([syntheticCard(other), syntheticCard(job), syntheticCard(done, true)])));
    const { container } = renderTracker(<Jobbar job={job} onSaveAsPdf={() => undefined} />);
    const picker = screen.getByRole("combobox", { name: "Job" });
    await userEvent.hover(picker);
    await waitFor(() => {
      expect(within(picker).getAllByRole("option")).toHaveLength(3);
    });
    expect(within(picker).getByRole("group", { name: "In progress (2)" })).toBeInTheDocument();
    expect(within(picker).getByRole("group", { name: "Complete (1)" })).toBeInTheDocument();
    expect(picker).toHaveValue(job.id);
    expect(screen.getByRole("option", { name: "S-0001 – 1 Example Rd (Survey-Strata)" })).toBeInTheDocument();
    await userEvent.selectOptions(picker, other.id);
    expect(router.push).toHaveBeenCalledWith(`/jobs/${other.id}`);
    await expectNoAxeViolations(container);
  });

  it("follows every page of the job list", async () => {
    const job = syntheticJob();
    const second = syntheticJob({ fields: { jobNumber: "S-9999", clientName: null } });
    const cursors: (string | null)[] = [];
    server.use(
      handlerFor("listJobs", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        cursors.push(cursor);
        return HttpResponse.json(cursor ? jobPage([syntheticCard(second)]) : jobPage([syntheticCard(job)], "next-1"));
      }),
    );
    renderTracker(<Jobbar job={job} onSaveAsPdf={() => undefined} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Job" }));
    expect(await screen.findByRole("option", { name: (name) => name.includes(second.jobNumber) })).toBeInTheDocument();
    expect(cursors).toEqual([null, "next-1"]);
  });

  it("asks the API for no jobs until the picker is reached for, and only the open job is listed before", async () => {
    const job = syntheticJob();
    const requests: string[] = [];
    server.use(
      handlerFor("listJobs", ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json(jobPage([syntheticCard(job)]));
      }),
    );
    renderTracker(<Jobbar job={job} onSaveAsPdf={() => undefined} />);
    const picker = screen.getByRole("combobox", { name: "Job" });
    expect(within(picker).getAllByRole("option")).toHaveLength(1);
    await screen.findByRole("link", { name: "Dashboard" });
    expect(requests).toEqual([]);
    await userEvent.hover(picker);
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    await userEvent.click(picker);
    expect(requests).toHaveLength(1);
  });

  it("links to the dashboard and saves as PDF with the spec's title", async () => {
    const job = syntheticJob();
    server.use(mockApi("listJobs", jobPage([])));
    const onSaveAsPdf = vi.fn();
    renderTracker(<Jobbar job={job} onSaveAsPdf={onSaveAsPdf} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
    const pdf = screen.getByRole("button", { name: "Save as PDF" });
    expect(pdf).toHaveAttribute("title", "Saves exactly what is showing – use Expand all first to include everything");
    await userEvent.click(pdf);
    expect(onSaveAsPdf).toHaveBeenCalledTimes(1);
  });

  it("offers EDIT JOB only with job.edit, and it opens the Job details dialog", async () => {
    server.use(mockApi("listJobs", jobPage([])));
    const readOnly = syntheticJob({ role: "external", grantRole: "architect" });
    const view = renderTracker(<Jobbar job={readOnly} onSaveAsPdf={() => undefined} />);
    expect(screen.queryByRole("button", { name: "EDIT JOB" })).toBeNull();
    view.unmount();
    renderTracker(<Jobbar job={syntheticJob()} onSaveAsPdf={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    expect(await screen.findByRole("dialog", { name: "Job details" })).toBeInTheDocument();
  });
});
