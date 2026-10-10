import { PROBLEM_TYPES, Problem } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { ApiProblem, INTERNAL_PROBLEM_TYPE, isProblem, networkProblem, problemFromResponse } from "./problem";

const valid = { type: PROBLEM_TYPES.validation, title: "Bad", status: 400, requestId: "req-1" };

describe("isProblem", () => {
  const bodies: [string, unknown][] = [
    ["a minimal problem", valid],
    [
      "a problem with detail, instance and field errors",
      { ...valid, detail: "d", instance: "/x", errors: [{ path: "a", message: "b" }] },
    ],
    ["a problem with an empty error list", { ...valid, errors: [] }],
    ["no request id", { type: "t", title: "x", status: 500 }],
    ["a fractional status", { ...valid, status: 400.5 }],
    ["a string status", { ...valid, status: "400" }],
    ["a numeric title", { ...valid, title: 4 }],
    ["a numeric detail", { ...valid, detail: 4 }],
    ["a non-array errors", { ...valid, errors: "x" }],
    ["an error without a message", { ...valid, errors: [{ path: "a" }] }],
    ["an error that is null", { ...valid, errors: [null] }],
    ["null", null],
    ["a string", "problem"],
    ["an array", [valid]],
    ["an empty object", {}],
  ];
  it.each(bodies)("agrees with the contract's Problem schema for %s", (_name, body) => {
    expect(isProblem(body)).toBe(Problem.safeParse(body).success);
  });

  it("uses the contract's internal problem type", () => {
    expect(INTERNAL_PROBLEM_TYPE).toBe(PROBLEM_TYPES.internal);
  });
});

describe("problemFromResponse", () => {
  it("returns the API's problem with its request id", async () => {
    const response = new Response(JSON.stringify({ ...valid, requestId: "req-7" }), { status: 400 });
    const problem = await problemFromResponse(response);
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem).toMatchObject({ status: 400, type: PROBLEM_TYPES.validation, requestId: "req-7" });
  });

  it("makes a generic problem from a body that is not one, taking the request id from the header", async () => {
    const response = new Response("<html>Bad gateway</html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "x-request-id": "req-edge-1" },
    });
    expect(await problemFromResponse(response)).toMatchObject({
      status: 502,
      type: INTERNAL_PROBLEM_TYPE,
      title: "Bad Gateway",
      requestId: "req-edge-1",
    });
  });

  it("makes a status 0 problem for no response at all", () => {
    expect(networkProblem()).toMatchObject({ status: 0, requestId: "" });
  });
});
