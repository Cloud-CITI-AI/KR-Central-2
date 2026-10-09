/** Synthetic data only (TD-1). */
import { faker } from "@faker-js/faker";
import { AuditEvent, JobCard, ManagedUser } from "@kr/contracts";

export function syntheticUser(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return ManagedUser.parse({
    id: faker.string.uuid(),
    displayName: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    role: "staff",
    isGuest: false,
    status: "active",
    lastSignInAt: "2026-09-28T03:50:56.543Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  });
}

export function syntheticAuditEvent(overrides: Record<string, unknown> = {}) {
  return AuditEvent.parse({
    id: faker.string.numeric(8),
    occurredAt: "2026-09-28T03:50:56.000Z",
    actor: { id: faker.string.uuid(), displayName: faker.person.fullName() },
    actorType: "user",
    action: "checkpoint.status_changed",
    jobId: faker.string.uuid(),
    entityType: "checkpoint",
    entityId: faker.string.uuid(),
    requestId: faker.string.alphanumeric(12),
    changes: { status: { from: "not_completed", to: "completed" } },
    ...overrides,
  });
}

export function syntheticJobCard(jobNumber: string) {
  return JobCard.parse({
    id: faker.string.uuid(),
    jobNumber,
    address: faker.location.streetAddress(),
    clientName: null,
    subdivisionType: null,
    isComplete: false,
    progress: { completed: 0, notCompleted: 46, notRequired: 0, total: 46, percent: 0 },
    nextActions: [],
    alerts: [],
    isWaitingOnClient: false,
    updatedAt: "2026-09-28T03:50:56.000Z",
  });
}
