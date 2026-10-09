/** Operation reads (BE-7: Kysely only). */
import type { Db, OperationRow } from "@kr/db";

export function findOperation(db: Db, operationId: string): Promise<OperationRow | undefined> {
  return db.selectFrom("operations").selectAll().where("id", "=", operationId).executeTakeFirst();
}
