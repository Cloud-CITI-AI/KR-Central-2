import { Problem } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { problemResponse } from "./problem";

describe("problemResponse", () => {
  it("is a contract-valid RFC 9457 problem with the request id and no cache", async () => {
    const res = problemResponse(502, "Bad Gateway", "req-1", "Try again.");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Problem.parse(await res.json())).toMatchObject({ status: 502, requestId: "req-1", detail: "Try again." });
  });

  it("uses the not-found type for 404 and omits an absent detail", async () => {
    const body = Problem.parse(await problemResponse(404, "Not found", "req-2").json());
    expect(body.type).toBe("urn:kr:problem:not-found");
    expect(body).not.toHaveProperty("detail");
  });
});
