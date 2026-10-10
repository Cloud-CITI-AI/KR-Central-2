/**
 * Whether `value` is a UUID, by the rule of the contract's `Uuid` (`z.uuid()`: RFC 9562 versions 1 to 8, plus the nil and
 * max UUIDs). Written out so a client module that only needs this check does not load Zod; uuid.test.ts compares the two.
 */
const UUID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
