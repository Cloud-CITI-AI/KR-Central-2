/** Synthetic data only (TD-1): never copy anything from the prototype's real job. */
import { globalCapabilitiesFor, Me, type GlobalRole } from "@kr/contracts";
import { faker } from "@faker-js/faker";

export function syntheticMe(role: GlobalRole = "staff", overrides: Partial<Me> = {}): Me {
  return Me.parse({
    user: {
      id: faker.string.uuid(),
      displayName: faker.person.fullName(),
      email: faker.internet.email().toLowerCase(),
      role,
      isGuest: role === "external",
      status: "active",
      lastSignInAt: "2026-09-28T03:50:56.543Z",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    capabilities: globalCapabilitiesFor(role),
    csrfToken: faker.string.alphanumeric(32),
    features: { aiStampReading: false, guestInvites: false, malwareScanning: true },
    uploadMaxBytes: 52_428_800,
    sessionExpiresAt: "2026-09-28T15:50:56.543Z",
    ...overrides,
  });
}
