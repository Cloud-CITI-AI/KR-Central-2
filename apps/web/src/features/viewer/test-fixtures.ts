/** Synthetic files (TD-1): never anything from the prototype's real job. */
import { FileMeta } from "@kr/contracts";
import { faker } from "@faker-js/faker";

export function syntheticFile(overrides: Partial<FileMeta> = {}): FileMeta {
  return FileMeta.parse({
    id: faker.string.uuid(),
    jobId: faker.string.uuid(),
    checkpointKey: null,
    conditionId: null,
    slot: null,
    name: `${faker.word.noun()}.pdf`,
    kind: "pdf",
    contentType: "application/pdf",
    sizeBytes: 1234,
    scanStatus: "clean",
    scanRetriesExhausted: false,
    uploadedAt: "2026-09-28T03:50:56.543Z",
    uploadedBy: null,
    canDelete: false,
    email: null,
    ...overrides,
  });
}
