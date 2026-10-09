import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { applyCheckpointEdit, mapCheckpoint } from "./cache";

const find = (job: ReturnType<typeof syntheticJob>, key: string) => {
  const found = job.checkpoints.find((c) => c.key === key);
  if (!found) throw new Error(key);
  return found;
};

describe("mapCheckpoint", () => {
  it("replaces one checkpoint and leaves the others as the same objects", () => {
    const job = syntheticJob();
    const next = mapCheckpoint(job, "i4_0", (c) => ({ ...c, krNote: "x" }));
    expect(find(next, "i4_0").krNote).toBe("x");
    expect(find(next, "i4_1")).toBe(find(job, "i4_1"));
  });
});

describe("applyCheckpointEdit", () => {
  it("sets the status and moves the progress, the stage and the job-complete flag", () => {
    const job = syntheticJob();
    const done = applyCheckpointEdit(job, "i13_2", { status: "completed" });
    expect(find(done, "i13_2")).toMatchObject({ status: "completed", storedStatus: "completed", version: 1 });
    expect(done.summary.progress.completed).toBe(1);
    expect(done.summary.isComplete).toBe(true);
    expect(done.summary.stages.find((s) => s.stage === "landgate")?.label).toBe("3 to do");
  });

  it("keeps the effective status of a checkpoint in an excluded stage at Not required", () => {
    const job = syntheticJob({ conditionAgencies: ["Water Corporation"] });
    const edited = applyCheckpointEdit(job, "i6_0", { status: "completed" });
    expect(find(edited, "i6_0")).toMatchObject({ status: "not_required", storedStatus: "completed" });
  });

  it("sets responsibility (including null) and the KR note without touching the summary", () => {
    const job = syntheticJob();
    const edited = applyCheckpointEdit(job, "i8_3", { responsibility: null, krNote: "Pay the Shire" });
    expect(find(edited, "i8_3")).toMatchObject({
      responsibility: null,
      krNote: "Pay the Shire",
      status: "not_completed",
    });
    expect(edited.summary).toBe(job.summary);
    expect(
      applyCheckpointEdit(edited, "i8_3", { responsibility: "kr" }).checkpoints.find((c) => c.key === "i8_3"),
    ).toMatchObject({
      responsibility: "kr",
      krNote: "Pay the Shire",
    });
  });
});
