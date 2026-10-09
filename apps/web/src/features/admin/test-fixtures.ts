/** Synthetic data only (TD-1). */
import { faker } from "@faker-js/faker";
import { User } from "@kr/contracts";

export function syntheticUser(overrides: Partial<User> = {}): User {
  return User.parse({
    id: faker.string.uuid(),
    displayName: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    role: "staff",
    isGuest: false,
    status: "active",
    lastSignInAt: "2026-09-28T03:50:56.543Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  });
}
