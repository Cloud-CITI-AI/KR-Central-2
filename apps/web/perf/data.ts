import { faker } from "@faker-js/faker";
import type { ApiSession } from "../e2e/harness/api-client";
import { createJob, patchCheckpoint, uniqueJobNumber } from "../e2e/harness/jobs";

const TYPES = ["Survey-Strata", "Freehold", "Built Strata"] as const;

/**
 * A dashboard with a realistic page of work: `count` synthetic jobs of mixed type, a few with checkpoints ticked off so the
 * progress bars differ. Names and addresses are generated (TD-1), never taken from the prototype.
 */
export async function seedDashboard(staff: ApiSession, count: number): Promise<void> {
  faker.seed(22);
  const jobs = [];
  for (let i = 0; i < count; i++) {
    jobs.push(
      await createJob(staff, {
        jobNumber: uniqueJobNumber("PERF"),
        address: `${faker.location.buildingNumber()} ${faker.location.street()}, ${faker.location.city()} WA`,
        clientName: faker.company.name(),
        subdivisionType: TYPES[i % TYPES.length] ?? "Freehold",
      }),
    );
  }
  for (const job of jobs.slice(0, 4)) {
    for (const key of ["i2_0", "i4_0"]) await patchCheckpoint(staff, job.id, key, { status: "completed" });
  }
}

/** A fresh job for one tracker sample: the sample ticks a checkpoint, so a job is never reused. */
export async function freshTrackerJob(staff: ApiSession): Promise<string> {
  return (await createJob(staff, { jobNumber: uniqueJobNumber("PERF"), clientName: faker.company.name() })).id;
}
