/** Synthetic dashboard data (TD-1): never copy anything from the prototype's real job. */
import { JobCard, JobDetail, JobFacets } from "@kr/contracts";
import { CHECKPOINT_KEYS } from "@kr/workflow";
import { faker } from "@faker-js/faker";
import type { Facets } from "./types";

export function syntheticJobCard(overrides: Partial<JobCard> = {}): JobCard {
  return JobCard.parse({
    id: faker.string.uuid(),
    jobNumber: `S-${faker.string.numeric(4)}`,
    address: faker.location.streetAddress(),
    clientName: faker.company.name(),
    subdivisionType: "Survey-Strata",
    isComplete: false,
    progress: { completed: 10, notCompleted: 30, notRequired: 6, total: 46, percent: 35 },
    nextActions: [],
    alerts: [],
    isWaitingOnClient: false,
    updatedAt: "2026-09-28T03:50:56.543Z",
    ...overrides,
  });
}

/** A valid, empty-ish job as `getJob` and `createJob` answer it (all 46 checkpoints not completed). */
export function syntheticJobDetail(overrides: Partial<JobDetail> = {}): JobDetail {
  const card = syntheticJobCard();
  return JobDetail.parse({
    id: card.id,
    jobNumber: card.jobNumber,
    address: card.address,
    clientName: card.clientName,
    subdivisionType: card.subdivisionType,
    approvalDate: null,
    approvalExpiry: null,
    conformedDate: null,
    conformedSource: null,
    outcomeDate: null,
    conditionsSource: null,
    checkpoints: CHECKPOINT_KEYS.map((key) => ({
      key,
      status: "not_completed",
      storedStatus: "not_completed",
      excludedByConditions: false,
      responsibility: null,
      krNote: "",
      paid: null,
      decision: null,
      files: [],
      isRestricted: false,
      version: 1,
      updatedAt: card.updatedAt,
    })),
    conditions: [],
    summary: { progress: card.progress, stages: [], isComplete: false, alerts: [], fileCount: 0 },
    capabilities: ["job.read"],
    viewerGrantRole: null,
    version: 1,
    createdAt: card.updatedAt,
    updatedAt: card.updatedAt,
    ...overrides,
  });
}

export function syntheticFacets(overrides: Partial<Facets> = {}): Facets {
  return JobFacets.parse({
    statusCounts: { in_progress: 5, complete: 2, all: 7 },
    typeCounts: { "": 5, "Survey-Strata": 3, "Built Strata": 0, Amalgamation: 1, Freehold: 1 },
    waitingOnClient: 2,
    needAttention: 1,
    ...overrides,
  });
}
