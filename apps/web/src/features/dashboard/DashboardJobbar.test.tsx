import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { DashboardJobbar } from "./DashboardJobbar";
import { LAST_JOB_KEY } from "./lastJob";
import { syntheticJobDetail } from "./test-fixtures";

afterEach(() => {
  localStorage.clear();
});

describe("DashboardJobbar", () => {
  it("links BACK TO TRACKER to the remembered job while it is still visible, and offers Save as PDF", async () => {
    const job = syntheticJobDetail();
    localStorage.setItem(LAST_JOB_KEY, job.id);
    server.use(mockApi("getJob", job));
    const { container } = renderWithProviders(<DashboardJobbar />);
    expect(await screen.findByRole("link", { name: "Back to tracker" })).toHaveAttribute("href", `/jobs/${job.id}`);
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("opens the browser print dialog for Save as PDF", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderWithProviders(<DashboardJobbar />);
    await userEvent.click(screen.getByRole("button", { name: "Save as PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("hides the back link when no job is remembered", () => {
    renderWithProviders(<DashboardJobbar />);
    expect(screen.queryByRole("link", { name: "Back to tracker" })).toBeNull();
  });

  it("ignores a remembered value that is not a job id", () => {
    localStorage.setItem(LAST_JOB_KEY, "../../admin");
    renderWithProviders(<DashboardJobbar />);
    expect(screen.queryByRole("link", { name: "Back to tracker" })).toBeNull();
  });

  it("hides the back link when the job is no longer visible", async () => {
    const jobId = syntheticJobDetail().id;
    localStorage.setItem(LAST_JOB_KEY, jobId);
    server.use(mockProblem("getJob", 404, PROBLEM_TYPES.notFound));
    const { queryClient } = renderWithProviders(<DashboardJobbar />);
    await waitFor(() => {
      expect(queryClient.getQueryState(queryKeys.jobs.detail(jobId))?.status).toBe("error");
    });
    expect(screen.queryByRole("link", { name: "Back to tracker" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
  });

  it("copes with blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderWithProviders(<DashboardJobbar />);
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to tracker" })).toBeNull();
  });
});
