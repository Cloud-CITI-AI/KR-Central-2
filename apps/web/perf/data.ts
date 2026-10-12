import { faker } from "@faker-js/faker";
import { createDb, type Db } from "@kr/db";
import { AGENCIES, CHECKPOINTS, JOB_COMPLETE_CHECKPOINT_KEY, addDays, businessToday } from "@kr/workflow";
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

/** PRODUCT_SPEC section 14 (Scale): the system is designed for up to 2,000 active jobs. */
export const DESIGNED_SCALE_JOBS = 2000;

const APPROVAL_KEYS = CHECKPOINTS.filter((c) => c.panels.some((p) => p.type === "approval")).map((c) => c.key);
/** Rows per INSERT: at most 7 bound values each, far below Postgres' 65,535 parameter limit. */
const STATE_CHUNK = 5000;
const JOB_CHUNK = 500;

function chunked<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * The designed scale, straight into Postgres (2,000 HTTP creates would take minutes): `count` jobs SC-00000.. with all 46
 * checkpoint states each, in every shape the summaries depend on: progress anywhere from 0 to done, a client's turn,
 * declined fee proposals, WAPC dates inside and outside the warning windows, and extracted conditions (some with a guessed
 * agency). Synthetic data only (TD-1); deterministic for a given count and day.
 */
export async function seedDesignedScale(databaseUrl: string, count: number = DESIGNED_SCALE_JOBS): Promise<void> {
  const db: Db = createDb({ connectionString: databaseUrl, applicationName: "perf-seed", maxConnections: 2 });
  try {
    faker.seed(2000);
    const today = businessToday(new Date());
    const jobs = Array.from({ length: count }, (_, i) => {
      const dated = i % 3 !== 0;
      return {
        job_number: `SC-${i.toString().padStart(5, "0")}`,
        address: `${faker.location.buildingNumber()} ${faker.location.street()}, ${faker.location.city()} WA`,
        client_name: faker.company.name(),
        subdivision_type: TYPES[i % TYPES.length] ?? "Freehold",
        approval_expiry: dated ? addDays(today, faker.number.int({ min: -30, max: 700 })) : null,
        outcome_date: dated ? addDays(today, faker.number.int({ min: -20, max: 60 })) : null,
      };
    });
    const ids: string[] = [];
    for (const rows of chunked(jobs, JOB_CHUNK)) {
      const inserted = await db.insertInto("jobs").values(rows).returning(["id", "job_number"]).execute();
      ids.push(...inserted.sort((a, b) => a.job_number.localeCompare(b.job_number)).map((r) => r.id));
    }
    const states = ids.flatMap((jobId, i) => {
      const done = i % 7 === 0;
      const ticked = done ? CHECKPOINTS.length : faker.number.int({ min: 0, max: CHECKPOINTS.length - 2 });
      const declined = i % 11 === 0 ? faker.helpers.arrayElement(APPROVAL_KEYS) : null;
      return CHECKPOINTS.map((c, n) => {
        const isDeclined = c.key === declined && !done;
        const complete = done ? true : n < ticked && !isDeclined && c.key !== JOB_COMPLETE_CHECKPOINT_KEY;
        return {
          job_id: jobId,
          checkpoint_key: c.key,
          status: complete ? ("completed" as const) : ("not_completed" as const),
          responsibility: i % 5 === 0 && n % 4 === 0 ? ("client" as const) : c.defaultResponsibility,
          decision: isDeclined ? ("declined" as const) : null,
          decision_comment: isDeclined ? "Too expensive for this subdivision" : "",
          decided_at: isDeclined ? new Date() : null,
        };
      });
    });
    for (const rows of chunked(states, STATE_CHUNK)) await db.insertInto("checkpoint_states").values(rows).execute();
    const conditions = ids.flatMap((jobId, i) =>
      i % 2 === 0
        ? []
        : Array.from({ length: faker.number.int({ min: 1, max: 8 }) }, (_, n) => ({
            job_id: jobId,
            condition_number: n + 1,
            text: faker.lorem.sentence(),
            agency: faker.helpers.arrayElement(AGENCIES),
            agency_guessed: faker.datatype.boolean(0.2),
            is_cleared: faker.datatype.boolean(0.4),
          })),
    );
    for (const rows of chunked(conditions, STATE_CHUNK)) await db.insertInto("conditions").values(rows).execute();
  } finally {
    await db.destroy();
  }
}
