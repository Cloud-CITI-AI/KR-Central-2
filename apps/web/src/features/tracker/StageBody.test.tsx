import { CHECKPOINTS, STAGES } from "@kr/workflow";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { syntheticJob } from "./test-fixtures";
import { StageBody } from "./StageBody";
import { TrackerBody } from "./TrackerBody";
import { renderTracker } from "./test-utils";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { jobPage } from "./test-fixtures";

const features = vi.hoisted(() => ({
  CheckpointCard: vi.fn(({ definition }: { definition: { number: string } }) => <p>card {definition.number}</p>),
  AgencyConditions: vi.fn(({ agency }: { agency: string }) => <p>conditions {agency}</p>),
  JobNotes: vi.fn((_props: unknown) => <p>notes</p>),
  JobFiles: vi.fn((_props: unknown) => <p>files</p>),
}));
vi.mock("@/features/checkpoints", () => ({ CheckpointCard: features.CheckpointCard }));
vi.mock("@/features/conditions", () => ({ AgencyConditions: features.AgencyConditions }));
vi.mock("@/features/notes", () => ({ JobNotes: features.JobNotes }));
vi.mock("@/features/job-files", () => ({ JobFiles: features.JobFiles }));
vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

const stage = (key: string) => {
  const found = STAGES.find((s) => s.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe("StageBody", () => {
  it("renders a card per checkpoint through CheckpointCard with job, checkpoint and definition unchanged", () => {
    const job = syntheticJob();
    features.CheckpointCard.mockClear();
    renderTracker(<StageBody job={job} stage={stage("wapc-approval")} />);
    const defs = stage("wapc-approval").checkpoints;
    expect(features.CheckpointCard).toHaveBeenCalledTimes(defs.length);
    for (const [index, definition] of defs.entries()) {
      const props = features.CheckpointCard.mock.calls[index]?.[0] as unknown;
      expect(props).toEqual({
        job,
        checkpoint: job.checkpoints.find((c) => c.key === definition.key),
        definition,
      });
      expect(document.getElementById(`checkpoint-${definition.key}`)).toHaveTextContent(`card ${definition.number}`);
    }
  });

  it("renders cards in workflow order and all 46 across the stages", () => {
    const job = syntheticJob();
    const { container } = renderTracker(
      <>
        {STAGES.map((s) => (
          <StageBody key={s.key} job={job} stage={s} />
        ))}
      </>,
    );
    expect([...container.querySelectorAll("[id^=checkpoint-]")].map((e) => e.id)).toEqual(
      CHECKPOINTS.map((c) => `checkpoint-${c.key}`),
    );
  });

  it("puts the agency conditions box first in agency stages and WAPC, and not in the other stages", () => {
    const job = syntheticJob();
    for (const [key, agency] of [
      ["western-power", "Western Power"],
      ["busselton-water", "Busselton Water"],
      ["wapc", "WAPC"],
    ] as const) {
      features.AgencyConditions.mockClear();
      const { unmount } = renderTracker(<StageBody job={job} stage={stage(key)} />);
      expect(features.AgencyConditions.mock.calls[0]?.[0]).toEqual({ job, agency });
      const conditions = screen.getByText(`conditions ${agency}`);
      expect(
        conditions.compareDocumentPosition(screen.getAllByText(/^card /)[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      unmount();
    }
    features.AgencyConditions.mockClear();
    renderTracker(<StageBody job={job} stage={stage("preliminaries")} />);
    expect(features.AgencyConditions).not.toHaveBeenCalled();
  });
});

describe("outcome box", () => {
  it("sits after 4.2 inside WAPC Approval and nowhere else", () => {
    const job = syntheticJob();
    const { container } = renderTracker(
      <>
        {STAGES.map((s) => (
          <StageBody key={s.key} job={job} stage={s} />
        ))}
      </>,
    );
    const boxes = screen.getAllByRole("group", { name: "WAPC outcome" });
    expect(boxes).toHaveLength(1);
    expect(document.getElementById("checkpoint-i4_2")?.nextElementSibling).toBe(boxes[0]);
    expect(within(container).getAllByRole("group")).toHaveLength(1);
  });
});

describe("TrackerBody", () => {
  it("places job notes and job files after the stages with the job id, capabilities and job", () => {
    const job = syntheticJob();
    server.use(mockApi("listJobs", jobPage([])));
    features.JobNotes.mockClear();
    features.JobFiles.mockClear();
    renderTracker(<TrackerBody job={job} />);
    expect(features.JobNotes.mock.calls[0]?.[0]).toEqual({ jobId: job.id, capabilities: job.capabilities });
    expect(features.JobFiles.mock.calls[0]?.[0]).toEqual({ job });
    const stages = screen.getByText("Stages");
    expect(stages.compareDocumentPosition(screen.getByText("notes")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
