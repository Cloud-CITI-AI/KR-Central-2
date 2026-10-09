import { faker } from "@faker-js/faker";
import { describe, expect, it, vi } from "vitest";

const tracker = vi.hoisted(() => ({ TrackerPage: vi.fn(() => null) }));
vi.mock("@/features/tracker", () => tracker);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import JobPage from "./page";

const call = (jobId: string, stage?: string | string[]) =>
  JobPage({ params: Promise.resolve({ jobId }), searchParams: Promise.resolve(stage === undefined ? {} : { stage }) });

describe("/jobs/[jobId] page", () => {
  it("renders the tracker for the job id, passes a valid ?stage= through and ignores anything else", async () => {
    const jobId = faker.string.uuid();
    expect((await call(jobId)).props).toEqual({ jobId });
    expect((await call(jobId, "western-power")).props).toEqual({ jobId, initialStage: "western-power" });
    expect((await call(jobId, ["survey", "titles"])).props).toEqual({ jobId, initialStage: "survey" });
    expect((await call(jobId, "nonsense")).props).toEqual({ jobId });
  });

  it("is a 404 for an id that cannot be a job", async () => {
    await expect(call("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
