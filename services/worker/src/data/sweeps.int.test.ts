import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "@kr/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertUser, openDb } from "../../test/db.js";
import { cutoffs } from "../domain/retention.js";
import { deleteExpiredRows } from "./sweeps.js";

const NOW = new Date("2026-10-09T08:00:00.000Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let db: Db;
let userId: string;
beforeAll(async () => {
  db = openDb();
  userId = await insertUser(db);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  await Promise.all([
    db.deleteFrom("sessions").execute(),
    db.deleteFrom("auth_flows").execute(),
    db.deleteFrom("idempotency_keys").execute(),
    db.deleteFrom("rate_limits").execute(),
  ]);
});

const hash = (): Buffer => createHash("sha256").update(randomBytes(8)).digest();

function session(o: { idle: Date; absolute: Date; revoked?: Date }) {
  return db
    .insertInto("sessions")
    .values({
      id_hash: hash(),
      user_id: userId,
      csrf_token: randomBytes(24).toString("hex"),
      auth_time: ago(30 * DAY),
      idle_expires_at: o.idle,
      absolute_expires_at: o.absolute,
      ...(o.revoked ? { revoked_at: o.revoked, revoked_reason: "logout" as const } : {}),
    })
    .returning("id_hash")
    .executeTakeFirstOrThrow();
}

describe("deleteExpiredRows", () => {
  it("deletes sessions 7 days after they expired or were revoked, and keeps the rest", async () => {
    const gone = [
      await session({ idle: ago(8 * DAY), absolute: ago(1 * DAY) }),
      await session({ idle: ago(1 * DAY), absolute: ago(8 * DAY) }),
      await session({ idle: ago(1 * HOUR), absolute: ago(1 * HOUR), revoked: ago(9 * DAY) }),
    ];
    const kept = [
      await session({ idle: ago(6 * DAY), absolute: ago(6 * DAY) }),
      await session({ idle: new Date(NOW.getTime() + HOUR), absolute: new Date(NOW.getTime() + DAY) }),
      await session({
        idle: new Date(NOW.getTime() + HOUR),
        absolute: new Date(NOW.getTime() + DAY),
        revoked: ago(2 * DAY),
      }),
    ];
    expect((await deleteExpiredRows(db, cutoffs(NOW))).sessions).toBe(3);
    const left = await db.selectFrom("sessions").select("id_hash").execute();
    expect(left.map((r) => r.id_hash.toString("hex")).sort()).toEqual(
      kept.map((r) => r.id_hash.toString("hex")).sort(),
    );
    expect(gone).toHaveLength(3);
  });

  it("deletes expired sign-in flows, idempotency keys older than 24 hours and expired rate-limit rows", async () => {
    const flow = (expires: Date) =>
      db
        .insertInto("auth_flows")
        .values({
          state_hash: hash(),
          nonce: "n",
          code_verifier: "v",
          return_to: "/",
          browser_binding_hash: hash(),
          created_at: ago(DAY),
          expires_at: expires,
        })
        .execute();
    await flow(ago(HOUR));
    await flow(new Date(NOW.getTime() + 60_000));
    const key = (created: Date) =>
      db
        .insertInto("idempotency_keys")
        .values({ user_id: userId, key: randomUUID(), operation_id: "op", request_hash: hash(), created_at: created })
        .execute();
    await key(ago(25 * HOUR));
    await key(ago(23 * HOUR));
    const limit = (expire: number | null) =>
      db
        .insertInto("rate_limits")
        .values({ key: randomUUID(), points: 1, expire: expire === null ? null : String(expire) })
        .execute();
    await limit(NOW.getTime() - 1000);
    await limit(NOW.getTime() + 60_000);
    await limit(null);

    expect(await deleteExpiredRows(db, cutoffs(NOW))).toEqual({
      sessions: 0,
      auth_flows: 1,
      idempotency_keys: 1,
      rate_limits: 1,
    });
    expect(await db.selectFrom("auth_flows").select("state_hash").execute()).toHaveLength(1);
    expect(await db.selectFrom("idempotency_keys").select("key").execute()).toHaveLength(1);
    expect(await db.selectFrom("rate_limits").select("key").execute()).toHaveLength(2);
  });

  it("works through more rows than one batch", async () => {
    await db
      .insertInto("rate_limits")
      .values(Array.from({ length: 2500 }, () => ({ key: randomUUID(), points: 1, expire: String(NOW.getTime() - 1) })))
      .execute();
    expect((await deleteExpiredRows(db, cutoffs(NOW))).rate_limits).toBe(2500);
  });
});
