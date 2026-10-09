/** Synthetic access grants (TD-1). */
import { AccessGrant } from "@kr/contracts";
import { faker } from "@faker-js/faker";
import type { Grant } from "./types";

export function syntheticGrant(overrides: Partial<Grant> = {}): Grant {
  return AccessGrant.parse({
    id: faker.string.uuid(),
    jobId: faker.string.uuid(),
    jobNumber: `S-${faker.string.numeric(4)}`,
    email: faker.internet.email().toLowerCase(),
    displayName: null,
    role: "client",
    status: "pending",
    invitationStatus: "not_sent",
    invitedAt: "2026-09-28T03:50:56.543Z",
    invitedBy: null,
    activatedAt: null,
    ...overrides,
  });
}
