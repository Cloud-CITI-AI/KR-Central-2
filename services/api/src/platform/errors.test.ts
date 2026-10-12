import { PROBLEM_TYPES } from "@kr/contracts";
import { StorageUnavailableError } from "@kr/storage";
import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionFailedError,
  PreconditionRequiredError,
  ServiceUnavailableError,
  TooManyRequestsError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  toProblem,
} from "./errors.js";

const rid = "req-12345678";

describe("toProblem", () => {
  it.each([
    [new BadRequestError(), 400, PROBLEM_TYPES.validation],
    [new UnauthenticatedError(), 401, PROBLEM_TYPES.unauthenticated],
    [new ForbiddenError(), 403, PROBLEM_TYPES.forbidden],
    [new NotFoundError(), 404, PROBLEM_TYPES.notFound],
    [new ConflictError(), 409, PROBLEM_TYPES.conflict],
    [new PreconditionFailedError(), 412, PROBLEM_TYPES.preconditionFailed],
    [new PayloadTooLargeError(), 413, PROBLEM_TYPES.payloadTooLarge],
    [new UnsupportedMediaTypeError(), 415, PROBLEM_TYPES.unsupportedMediaType],
    [new PreconditionRequiredError(), 428, PROBLEM_TYPES.preconditionRequired],
    [new TooManyRequestsError(3), 429, PROBLEM_TYPES.rateLimited],
    [new ServiceUnavailableError(), 503, PROBLEM_TYPES.internal],
  ])("maps %s to %i with its stable type", (error, status, type) => {
    const { problem } = toProblem(error, rid, "/v1/x");
    expect(problem).toMatchObject({ status, type, requestId: rid, instance: "/v1/x" });
    expect(error).toBeInstanceOf(AppError);
  });

  it("carries detail, a type override, field errors and rounds Retry-After up to whole seconds", () => {
    const e = new ConflictError({
      detail: "File is still scanning.",
      type: PROBLEM_TYPES.fileNotReady,
      errors: [{ path: "fileId", message: "not ready" }],
    });
    expect(toProblem(e, rid).problem).toMatchObject({
      type: PROBLEM_TYPES.fileNotReady,
      detail: "File is still scanning.",
      errors: [{ path: "fileId", message: "not ready" }],
    });
    expect(toProblem(new TooManyRequestsError(1.2), rid).headers).toEqual({ "retry-after": "2" });
    expect(toProblem(new TooManyRequestsError(0), rid).headers).toEqual({ "retry-after": "1" });
  });

  it.each(["22021", "22P05"])("maps Postgres %s (text Postgres cannot store, e.g. NUL) to a 400, not a 500", (code) => {
    const pgError = Object.assign(new Error("invalid byte sequence for encoding UTF8: 0x00"), { code });
    expect(toProblem(pgError, rid, "/v1/x").problem).toMatchObject({
      status: 400,
      type: PROBLEM_TYPES.validation,
      detail: "The request could not be parsed.",
    });
  });

  it("maps a storage outage to 503 with Retry-After and its own problem type", () => {
    const { problem, headers } = toProblem(new StorageUnavailableError(new Error("ECONNREFUSED")), rid, "/v1/x");
    expect(headers).toEqual({ "retry-after": "5" });
    expect(problem).toMatchObject({
      status: 503,
      type: PROBLEM_TYPES.storageUnavailable,
      detail: "File storage is temporarily unavailable. Try again shortly.",
    });
    expect(JSON.stringify(problem)).not.toContain("ECONNREFUSED");
  });

  it("answers unknown errors with a generic 500 and no internals", () => {
    const secret = new Error("select * from users where password = 'hunter2'");
    const { problem } = toProblem(secret, rid, "/v1/x");
    expect(problem).toEqual({
      type: "about:blank",
      title: "Internal server error",
      status: 500,
      instance: "/v1/x",
      requestId: rid,
    });
    expect(JSON.stringify(problem)).not.toContain("hunter2");
    expect(toProblem("a string", rid).problem.status).toBe(500);
  });

  it("maps Fastify's own client errors without echoing their message", () => {
    const tooLarge = Object.assign(new Error("Request body is too large"), {
      statusCode: 413,
      code: "FST_ERR_CTP_BODY_TOO_LARGE",
    });
    expect(toProblem(tooLarge, rid).problem.status).toBe(413);
    const media = Object.assign(new Error("Unsupported Media Type: text/x"), {
      statusCode: 415,
      code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
    });
    expect(toProblem(media, rid).problem.status).toBe(415);
    const bad = Object.assign(new Error("Unexpected token } in JSON at position 4"), {
      statusCode: 400,
      code: "FST_ERR_CTP_INVALID_JSON_BODY",
    });
    const { problem } = toProblem(bad, rid);
    expect(problem).toMatchObject({ status: 400, detail: "The request could not be parsed." });
    expect(JSON.stringify(problem)).not.toContain("token");
  });

  it("maps Fastify's path-parameter length error (414) to a problem that does not echo the path", () => {
    const path = `/v1/jobs/${"a".repeat(600)}`;
    const tooLong = Object.assign(new Error(`'${path}' is exceeding the max param length`), {
      statusCode: 414,
      code: "FST_ERR_MAX_PARAM_LENGTH",
    });
    const { problem } = toProblem(tooLong, rid);
    expect(problem).toEqual({
      type: PROBLEM_TYPES.uriTooLong,
      title: "URI too long",
      status: 414,
      detail: "A value in the address is too long.",
      requestId: rid,
    });
    expect(JSON.stringify(problem)).not.toContain("aaaa");
  });
});
