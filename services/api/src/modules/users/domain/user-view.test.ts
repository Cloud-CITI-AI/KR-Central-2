import type { UserRow } from "@kr/db";
import { describe, expect, it } from "vitest";
import { containsPattern, toUser } from "./user-view.js";

describe("toUser", () => {
  it("maps a row and renders instants as ISO strings", () => {
    const row = {
      id: "u",
      display_name: "Pat Example",
      email: "pat@example.test",
      role: "kr_admin",
      is_guest: false,
      status: "active",
      version: 4,
      last_sign_in_at: new Date("2026-03-02T01:00:00Z"),
      created_at: new Date("2026-01-01T00:00:00Z"),
    } as UserRow;
    expect(toUser(row)).toEqual({
      id: "u",
      displayName: "Pat Example",
      email: "pat@example.test",
      role: "kr_admin",
      isGuest: false,
      status: "active",
      version: 4,
      lastSignInAt: "2026-03-02T01:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(toUser({ ...row, last_sign_in_at: null, email: null }).lastSignInAt).toBeNull();
  });
});

describe("containsPattern", () => {
  it("escapes the LIKE wildcards", () => {
    expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(containsPattern("plain")).toBe("%plain%");
  });
});
