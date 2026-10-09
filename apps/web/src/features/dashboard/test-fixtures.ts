/** Synthetic dashboard data (TD-1): never copy anything from the prototype's real job. */
import { JobCard, JobFacets } from "@kr/contracts";
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

export function syntheticFacets(overrides: Partial<Facets> = {}): Facets {
  return JobFacets.parse({
    statusCounts: { in_progress: 5, complete: 2, all: 7 },
    typeCounts: { "": 5, "Survey-Strata": 3, "Built Strata": 0, Amalgamation: 1, Freehold: 1 },
    waitingOnClient: 2,
    needAttention: 1,
    ...overrides,
  });
}
