/** Synthetic job notes (TD-1). */
import { JobNote } from "@kr/contracts";
import { faker } from "@faker-js/faker";
import type { Note } from "./types";

export function syntheticNote(overrides: Partial<Note> = {}): Note {
  return JobNote.parse({
    id: faker.string.uuid(),
    jobId: faker.string.uuid(),
    body: faker.lorem.sentence(),
    audience: "all",
    author: { id: faker.string.uuid(), displayName: faker.person.fullName() },
    isOwn: false,
    canDelete: false,
    createdAt: "2026-09-28T07:50:00.000Z",
    ...overrides,
  });
}
