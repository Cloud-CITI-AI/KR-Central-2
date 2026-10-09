import { PROBLEM_TYPES, type FileMeta, type JobDetail } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { syntheticFile } from "@/features/checkpoints/test-fixtures";
import { renderCard } from "@/features/checkpoints/test-utils";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checklistCard as group, threeConditions } from "./test-utils";
import { conditionAt, withCondition } from "./test-fixtures";

const viewer = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/features/viewer", () => ({ useViewer: () => viewer }));

const evidence = (jobId: string, conditionId: string, name: string, overrides: Partial<FileMeta> = {}) =>
  syntheticFile(jobId, { name, conditionId, ...overrides });

/** Three conditions; the first has two pieces of evidence. */
function withEvidence(): { job: JobDetail; files: FileMeta[] } {
  const base = threeConditions();
  const first = conditionAt(base, 0);
  const files = [evidence(base.id, first.id, "Stat dec.pdf"), evidence(base.id, first.id, "Site.pdf")];
  return { job: withCondition(base, first.id, { evidence: files }), files };
}

describe("condition evidence files", () => {
  it("lists a condition's evidence in its card, and nothing for a condition without any", async () => {
    const { job } = withEvidence();
    const { container } = renderCard(job, "i5_0");
    expect(within(group(1)).getByRole("button", { name: "Stat dec.pdf" })).toBeInTheDocument();
    expect(within(group(1)).getByRole("button", { name: "Site.pdf" })).toBeInTheDocument();
    expect(within(group(2)).queryByRole("list")).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("opens the viewer on the file, paging through the condition's evidence", async () => {
    const { job, files } = withEvidence();
    renderCard(job, "i5_0");
    await userEvent.click(within(group(1)).getByRole("button", { name: "Site.pdf" }));
    expect(viewer.open).toHaveBeenCalledWith(files, 1);
  });

  it("shows a blocked file as such and cannot open it", () => {
    const base = threeConditions();
    const first = conditionAt(base, 0);
    const bad = evidence(base.id, first.id, "Virus.pdf", { scanStatus: "infected" });
    renderCard(withCondition(base, first.id, { evidence: [bad] }), "i5_0");
    expect(within(group(1)).getByText("Blocked – failed the virus scan")).toBeInTheDocument();
    expect(within(group(1)).queryByRole("button", { name: "Virus.pdf" })).not.toBeInTheDocument();
  });

  it("removes a file after 'Remove? Yes', at once, and refreshes the job", async () => {
    const { job, files } = withEvidence();
    const { served } = renderCard(job, "i5_0");
    const removed: string[] = [];
    server.use(
      handlerFor("deleteFile", ({ params }) => {
        removed.push(String(params.fileId));
        served.job = withCondition(job, conditionAt(job, 0).id, { evidence: files.slice(1) });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await userEvent.click(within(group(1)).getByRole("button", { name: "Remove Stat dec.pdf" }));
    expect(within(group(1)).getByText("Remove?")).toBeInTheDocument();
    await userEvent.click(within(group(1)).getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(within(group(1)).queryByRole("button", { name: "Stat dec.pdf" })).not.toBeInTheDocument();
    });
    expect(removed).toEqual([files[0]?.id]);
    expect(within(group(1)).getByRole("button", { name: "Site.pdf" })).toBeInTheDocument();
  });

  it("puts the file back and shows the save-failed banner when removing fails", async () => {
    const { job } = withEvidence();
    renderCard(job, "i5_0");
    server.use(mockProblem("deleteFile", 500));
    await userEvent.click(within(group(1)).getByRole("button", { name: "Remove Stat dec.pdf" }));
    await userEvent.click(within(group(1)).getByRole("button", { name: "Yes" }));
    expect(await screen.findByText(/A change couldn't be saved\./)).toBeInTheDocument();
    expect(within(group(1)).getByRole("button", { name: "Stat dec.pdf" })).toBeInTheDocument();
  });

  it("lets a file that someone else removed meanwhile (404) just disappear", async () => {
    const { job, files } = withEvidence();
    const { served } = renderCard(job, "i5_0");
    server.use(
      handlerFor("deleteFile", () => {
        served.job = withCondition(job, conditionAt(job, 0).id, { evidence: files.slice(1) });
        return HttpResponse.json(
          { type: PROBLEM_TYPES.notFound, title: "Not found", status: 404, requestId: "req-test-0001" },
          { status: 404, headers: { "content-type": "application/problem+json" } },
        );
      }),
    );
    await userEvent.click(within(group(1)).getByRole("button", { name: "Remove Stat dec.pdf" }));
    await userEvent.click(within(group(1)).getByRole("button", { name: "Yes" }));
    await waitFor(() => {
      expect(within(group(1)).queryByRole("button", { name: "Stat dec.pdf" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/A change couldn't be saved\./)).not.toBeInTheDocument();
  });

  it("offers no × for a file the viewer may not delete", () => {
    const base = threeConditions();
    const first = conditionAt(base, 0);
    const locked = evidence(base.id, first.id, "Locked.pdf", { canDelete: false });
    renderCard(withCondition(base, first.id, { evidence: [locked] }), "i5_0");
    expect(within(group(1)).queryByRole("button", { name: "Remove Locked.pdf" })).not.toBeInTheDocument();
  });
});
