/**
 * Seeded faker factories over a real database (synthetic data only, TD-1). Each factory instance is deterministic for
 * its seed; the default seed is derived from the test file so parallel files never collide on unique columns.
 */
import { createHash } from "node:crypto";
import type { GlobalRole } from "@kr/contracts";
import type { AccessGrantRow, ConditionRow, Db, EmailMessageRow, FileRow, JobNoteRow, JobRow, UserRow } from "@kr/db";
import { objectKeyFor } from "@kr/storage";
import { AGENCIES, CHECKPOINTS, SUBDIVISION_TYPES, type Agency } from "@kr/workflow";
import { Faker, en, en_AU } from "@faker-js/faker";
import { expect } from "vitest";

export const TEST_TENANT_ID = "11111111-1111-4111-8111-111111111111";

function seedFromTestFile(): number {
  const file = expect.getState().testPath ?? "unknown";
  return createHash("sha256").update(file).digest().readUInt32BE(0);
}

export interface UserOverrides {
  readonly role?: GlobalRole;
  readonly status?: "active" | "disabled";
  readonly isGuest?: boolean;
  readonly email?: string | null;
  readonly displayName?: string;
}

export interface JobOverrides {
  readonly jobNumber?: string;
  readonly createdBy?: string | null;
  /** Archived (soft-deleted) when set. */
  readonly deletedAt?: Date | null;
}

export interface GrantOverrides {
  readonly jobId: string;
  readonly role?: "client" | "architect";
  readonly status?: "pending" | "active" | "revoked";
  /** Required for active grants (bound user). */
  readonly userId?: string | null;
  readonly email?: string;
}

export interface ConditionOverrides {
  readonly jobId: string;
  readonly number: number;
  readonly agency?: Agency;
  readonly isCleared?: boolean;
}

export interface FileOverrides {
  readonly jobId: string;
  /** Checkpoint slot target (default i2_0 / "documents") unless `conditionId` is given (evidence). */
  readonly checkpointKey?: string;
  readonly slot?: string;
  readonly conditionId?: string;
  readonly uploadedBy?: string | null;
  readonly scanStatus?: FileRow["scan_status"];
  readonly kind?: FileRow["kind"];
  readonly name?: string;
  readonly sizeBytes?: number;
}

const WA_TOWNS = ["Busselton", "Dunsborough", "Margaret River", "Bunbury", "Mandurah", "Rockingham"];

export function createFactories(db: Db, seed: number = seedFromTestFile()) {
  const faker = new Faker({ locale: [en_AU, en] });
  faker.seed(seed);
  const prefix = `T${seed.toString(36).slice(0, 6).toUpperCase()}`;
  let jobCounter = 0;
  return {
    faker,
    async makeUser(o: UserOverrides = {}): Promise<UserRow> {
      const role = o.role ?? "staff";
      return db
        .insertInto("users")
        .values({
          entra_tenant_id: TEST_TENANT_ID,
          entra_object_id: faker.string.uuid(),
          email: o.email === undefined ? faker.internet.email({ provider: "example.test" }).toLowerCase() : o.email,
          display_name: o.displayName ?? faker.person.fullName(),
          role,
          is_guest: o.isGuest ?? role === "external",
          status: o.status ?? "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    /** A job with its 46 checkpoint_states (default responsibilities), like the real createJob. Synthetic data only. */
    async makeJob(o: JobOverrides = {}): Promise<JobRow> {
      jobCounter += 1;
      return db.transaction().execute(async (trx) => {
        const job = await trx
          .insertInto("jobs")
          .values({
            job_number: o.jobNumber ?? `${prefix}-${jobCounter}`,
            address: `${faker.location.streetAddress()}, ${faker.helpers.arrayElement(WA_TOWNS)} WA ${faker.number.int({ min: 6000, max: 6999 })}`,
            client_name: `${faker.company.name()} Pty Ltd`,
            subdivision_type: faker.helpers.arrayElement(SUBDIVISION_TYPES),
            created_by: o.createdBy ?? null,
            deleted_at: o.deletedAt ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("checkpoint_states")
          .values(
            CHECKPOINTS.map((c) => ({
              job_id: job.id,
              checkpoint_key: c.key,
              responsibility: c.defaultResponsibility,
            })),
          )
          .execute();
        return job;
      });
    },
    async makeCondition(o: ConditionOverrides): Promise<ConditionRow> {
      return db
        .insertInto("conditions")
        .values({
          job_id: o.jobId,
          condition_number: o.number,
          text: faker.lorem.sentence(),
          agency: o.agency ?? faker.helpers.arrayElement(AGENCIES),
          is_cleared: o.isCleared ?? false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    /** File metadata row (no object in storage); the storage key follows the real layout jobs/<jobId>/<fileId>. */
    async makeFile(o: FileOverrides): Promise<FileRow> {
      const id = faker.string.uuid();
      const target = o.conditionId
        ? { condition_id: o.conditionId }
        : { checkpoint_key: o.checkpointKey ?? "i2_0", slot: o.slot ?? "documents" };
      return db
        .insertInto("files")
        .values({
          id,
          job_id: o.jobId,
          ...target,
          storage_key: objectKeyFor(o.jobId, id),
          original_name: o.name ?? faker.system.commonFileName("pdf"),
          kind: o.kind ?? "pdf",
          content_type: "application/pdf",
          size_bytes: o.sizeBytes ?? faker.number.int({ min: 1_000, max: 5_000_000 }),
          sha256: Buffer.from(faker.string.hexadecimal({ length: 64, prefix: "" }), "hex"),
          scan_status: o.scanStatus ?? "clean",
          uploaded_by: o.uploadedBy ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    async makeEmail(fileId: string, o: { parsed?: boolean } = {}): Promise<EmailMessageRow> {
      return db
        .insertInto("email_messages")
        .values({
          file_id: fileId,
          parse_status: o.parsed === false ? "pending" : "parsed",
          subject: faker.lorem.words(4),
          from_text: "assessor@example.test",
          to_text: "surveyor@example.test",
          sent_at: new Date("2026-02-03T02:00:00Z"),
          body_text: faker.lorem.paragraph(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    async makeNote(o: {
      jobId: string;
      authorId: string | null;
      audience?: JobNoteRow["audience"];
    }): Promise<JobNoteRow> {
      return db
        .insertInto("job_notes")
        .values({ job_id: o.jobId, author_id: o.authorId, body: faker.lorem.sentence(), audience: o.audience ?? "all" })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
    async makeGrant(o: GrantOverrides): Promise<AccessGrantRow> {
      const status = o.status ?? "active";
      const bound = status === "active" || o.userId;
      return db
        .insertInto("access_grants")
        .values({
          job_id: o.jobId,
          email: o.email ?? faker.internet.email({ provider: "example.test" }).toLowerCase(),
          role: o.role ?? "client",
          status,
          user_id: o.userId ?? null,
          ...(bound ? { activated_at: new Date() } : {}),
          ...(status === "revoked" ? { revoked_at: new Date() } : {}),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  };
}

export type Factories = ReturnType<typeof createFactories>;
