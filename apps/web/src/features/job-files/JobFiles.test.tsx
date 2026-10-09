import { jobCapabilitiesFor, type JobDetail } from "@kr/contracts";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";
import { JobFiles } from "./JobFiles";

function jobWith(fileCount: number, capabilities = jobCapabilitiesFor("staff", null)): JobDetail {
  const job = syntheticJob();
  return { ...job, summary: { ...job.summary, fileCount }, capabilities };
}

describe("JobFiles", () => {
  it("counts the files and offers the zip as a plain link through the BFF", async () => {
    const job = jobWith(18);
    const { container } = renderWithProviders(<JobFiles job={job} />);
    expect(screen.getByRole("heading", { name: "Job files" })).toBeInTheDocument();
    expect(screen.getByText("18 files across the stages above")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Download all files (.zip)" });
    expect(link).toHaveAttribute("href", `/api/v1/jobs/${job.id}/package`);
    await expectNoAxeViolations(container);
  });

  it("says '1 file' in the singular", () => {
    renderWithProviders(<JobFiles job={jobWith(1)} />);
    expect(screen.getByText("1 file across the stages above")).toBeInTheDocument();
  });

  it("says so and disables the button when there are no files", async () => {
    const { container } = renderWithProviders(<JobFiles job={jobWith(0)} />);
    expect(screen.getByText("No files uploaded to this job yet")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download all files (.zip)" })).toBeDisabled();
    await expectNoAxeViolations(container);
  });

  it("offers no download to someone without package.download", () => {
    renderWithProviders(<JobFiles job={jobWith(3, ["job.read"])} />);
    expect(screen.getByText("3 files across the stages above")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
