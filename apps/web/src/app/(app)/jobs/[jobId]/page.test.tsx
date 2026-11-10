import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tracker = vi.hoisted(() => ({ TrackerPage: vi.fn(() => null) }));
vi.mock("@/features/tracker", () => tracker);
const jobs = vi.hoisted(() => ({ getJobSummary: vi.fn() }));
vi.mock("@/lib/session/get-job", () => jobs);
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import JobPage, { generateMetadata } from "./page";

const call = (jobId: string, stage?: string | string[]) =>
  JobPage({ params: Promise.resolve({ jobId }), searchParams: Promise.resolve(stage === undefined ? {} : { stage }) });

beforeEach(() => {
  jobs.getJobSummary.mockImplementation((id: string) =>
    Promise.resolve({
      id,
      jobNumber: "P-0001",
      address: "1 Synthetic Way, Testville",
      clientName: "Synthetic Client",
      subdivisionType: "Freehold",
      summary: { isComplete: false },
    }),
  );
});
/** What the page hands the tracker so the job's heading is in the first HTML. */
const heading = {
  jobNumber: "P-0001",
  address: "1 Synthetic Way, Testville",
  clientName: "Synthetic Client",
  subdivisionType: "Freehold",
  isComplete: false,
};

describe("/jobs/[jobId] page", () => {
  it("renders the tracker for the job id, passes a valid ?stage= through and ignores anything else", async () => {
    const jobId = faker.string.uuid();
    expect((await call(jobId)).props).toEqual({ jobId, heading });
    expect((await call(jobId, "western-power")).props).toEqual({ jobId, heading, initialStage: "western-power" });
    expect((await call(jobId, ["survey", "titles"])).props).toEqual({ jobId, heading, initialStage: "survey" });
    expect((await call(jobId, "nonsense")).props).toEqual({ jobId, heading });
  });

  it("is a 404 for an id that cannot be a job, without asking the API", async () => {
    await expect(call("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(jobs.getJobSummary).not.toHaveBeenCalled();
  });

  it("is a 404 (before anything renders) for a job that is missing, archived or not the caller's", async () => {
    jobs.getJobSummary.mockResolvedValue(null);
    await expect(call(faker.string.uuid())).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/jobs/[jobId] metadata", () => {
  it("titles the page with the job number and address", async () => {
    const jobId = faker.string.uuid();
    await expect(generateMetadata({ params: Promise.resolve({ jobId }) })).resolves.toEqual({
      title: "P-0001 – 1 Synthetic Way, Testville",
    });
  });

  it("titles a job that cannot be shown like the not-found page", async () => {
    jobs.getJobSummary.mockResolvedValue(null);
    await expect(generateMetadata({ params: Promise.resolve({ jobId: faker.string.uuid() }) })).resolves.toEqual({
      title: "Page not found",
    });
    await expect(generateMetadata({ params: Promise.resolve({ jobId: "not-a-uuid" }) })).resolves.toEqual({
      title: "Page not found",
    });
  });
});
