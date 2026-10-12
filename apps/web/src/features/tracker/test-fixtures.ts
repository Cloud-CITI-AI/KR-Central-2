/** Synthetic jobs for tracker tests (TD-1: nothing here comes from the prototype's real job). */
import { faker } from "@faker-js/faker";
import { JobCard, JobDetail, jobCapabilitiesFor, type GlobalRole, type GrantRole } from "@kr/contracts";
import {
  CHECKPOINTS,
  STAGES,
  effectiveState,
  summariseProgress,
  summariseStage,
  type Agency,
  type CheckpointStatus,
} from "@kr/workflow";

export interface SyntheticJobOptions {
  readonly statuses?: Readonly<Record<string, CheckpointStatus>>;
  /** One extracted condition per agency (stages of the other agencies are then excluded, R1). */
  readonly conditionAgencies?: readonly Agency[];
  readonly role?: GlobalRole;
  readonly grantRole?: GrantRole | null;
  readonly fields?: Partial<JobDetail>;
}

const UPDATED = "2026-09-28T03:50:56.543Z";

export function syntheticJob({
  statuses = {},
  conditionAgencies = [],
  role = "staff",
  grantRole = null,
  fields = {},
}: SyntheticJobOptions = {}): JobDetail {
  const conditions = conditionAgencies.map((agency, index) => ({
    id: faker.string.uuid(),
    number: index + 1,
    text: faker.lorem.sentence(),
    agency,
    agencyGuessed: false,
    isCleared: false,
    responsibility: null,
    krComment: "",
    clientComment: "",
    evidence: [],
    version: 1,
    updatedAt: UPDATED,
  }));
  const input = {
    states: Object.fromEntries(
      CHECKPOINTS.map((c) => [
        c.key,
        { status: statuses[c.key] ?? "not_completed", responsibility: c.defaultResponsibility },
      ]),
    ),
    conditions,
  };
  const checkpoints = CHECKPOINTS.map((c) => {
    const state = effectiveState(c.key, input);
    return {
      key: c.key,
      status: state.status,
      storedStatus: state.storedStatus,
      excludedByConditions: state.excludedByConditions,
      responsibility: state.responsibility,
      krNote: "",
      paid: null,
      decision: null,
      files: [],
      isRestricted: false,
      version: 1,
      updatedAt: UPDATED,
    };
  });
  return JobDetail.parse({
    id: faker.string.uuid(),
    jobNumber: `S-${faker.string.numeric(4)}`,
    address: faker.location.streetAddress(),
    clientName: faker.company.name(),
    subdivisionType: "Survey-Strata",
    approvalDate: null,
    approvalExpiry: null,
    conformedDate: null,
    conformedSource: null,
    outcomeDate: null,
    conditionsSource: null,
    checkpoints,
    conditions,
    activeOperations: [],
    summary: {
      progress: summariseProgress(input),
      stages: STAGES.map((stage) => summariseStage(stage, input)),
      isComplete: effectiveState("i13_2", input).status === "completed",
      alerts: [],
      fileCount: 0,
    },
    capabilities: jobCapabilitiesFor(role, grantRole),
    viewerGrantRole: grantRole,
    version: 1,
    createdAt: UPDATED,
    updatedAt: UPDATED,
    ...fields,
  });
}

/** A dashboard/picker card for `job` (what `listJobs` answers). */
export function syntheticCard(
  job: Pick<JobDetail, "id" | "jobNumber" | "address" | "clientName" | "subdivisionType">,
  isComplete = false,
) {
  return JobCard.parse({
    id: job.id,
    jobNumber: job.jobNumber,
    address: job.address,
    clientName: job.clientName,
    subdivisionType: job.subdivisionType,
    isComplete,
    progress: { completed: 0, notCompleted: 46, notRequired: 0, total: 46, percent: 0 },
    nextActions: [],
    alerts: [],
    isWaitingOnClient: false,
    updatedAt: UPDATED,
  });
}

export const jobPage = (items: readonly unknown[], nextCursor: string | null = null) => ({ items, nextCursor });
