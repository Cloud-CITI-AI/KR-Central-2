import { describe, expect, it } from "vitest";
import { pgEnv, withSslMode } from "./pg-url.js";

describe("pgEnv", () => {
  it("splits a URL into libpq variables and decodes percent-escapes", () => {
    expect(pgEnv("postgres://tracker_migrator:p%40ss%2Fword@db.internal:6543/tracker", false)).toEqual({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "tracker_migrator",
      PGPASSWORD: "p@ss/word",
      PGDATABASE: "tracker",
      PGSSLMODE: "prefer",
      PGCONNECT_TIMEOUT: "15",
      PGAPPNAME: "kr-ops",
    });
  });

  it("defaults the port and unwraps an IPv6 host", () => {
    const env = pgEnv("postgres://u:p@[fd12::1]/tracker", false);
    expect(env).toMatchObject({ PGHOST: "fd12::1", PGPORT: "5432" });
  });

  it("verifies the server against the system CAs when DATABASE_SSL is on", () => {
    expect(pgEnv("postgres://u:p@db/tracker?sslmode=disable", true)).toMatchObject({
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "system",
    });
  });

  it("keeps an explicit sslmode from the URL when DATABASE_SSL is off", () => {
    const env = pgEnv("postgres://u:p@db/tracker?sslmode=require", false);
    expect(env.PGSSLMODE).toBe("require");
    expect(env).not.toHaveProperty("PGSSLROOTCERT");
  });

  it("never puts the password anywhere but PGPASSWORD", () => {
    const env = pgEnv("postgres://u:s3cret-value@db/tracker", false);
    expect(Object.entries(env).filter(([, v]) => v.includes("s3cret-value"))).toEqual([["PGPASSWORD", "s3cret-value"]]);
  });
});

describe("withSslMode", () => {
  it("leaves the URL alone without DATABASE_SSL", () => {
    expect(withSslMode("postgres://u:p@db/tracker", false)).toBe("postgres://u:p@db/tracker");
  });

  it("adds sslmode=verify-full, replacing a weaker one", () => {
    expect(new URL(withSslMode("postgres://u:p@db/tracker?sslmode=require", true)).searchParams.get("sslmode")).toBe(
      "verify-full",
    );
  });
});
