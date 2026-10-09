import { createDb } from "@kr/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, testConfig, type TestApp } from "../../test/helpers/index.js";

describe("health endpoints (real Postgres)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it("GET /healthz is 200 and needs no dependencies or session", async () => {
    const res = await t.app.inject({ url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: {} });
  });

  it("GET /readyz is 200 when the database and storage answer", async () => {
    const res = await t.app.inject({ url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { database: "ok", storage: "ok" } });
  });

  it("GET /readyz is 503 when storage is down", async () => {
    t.storage.failPing = true;
    try {
      const res = await t.app.inject({ url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "degraded", checks: { database: "ok", storage: "fail" } });
    } finally {
      t.storage.failPing = false;
    }
  });

  it("GET /readyz is 503 when the database is unreachable, without leaking the error", async () => {
    const down = createDb({ connectionString: "postgres://tracker_app:secret-pw@127.0.0.1:1/tracker" });
    const broken = await createTestApp({ db: down, config: testConfig() });
    try {
      const res = await broken.app.inject({ url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "degraded", checks: { database: "fail", storage: "ok" } });
      expect(res.body).not.toContain("secret-pw");
    } finally {
      await broken.close();
      await down.destroy();
    }
  });
});
