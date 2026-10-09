import { describe, expect, it } from "vitest";
import { assertVersion, formatEtag, parseIfMatch } from "./concurrency.js";
import { BadRequestError, PreconditionFailedError, PreconditionRequiredError } from "./errors.js";

describe("If-Match", () => {
  it("parses a quoted version", () => {
    expect(parseIfMatch({ "if-match": '"3"' })).toBe(3);
    expect(formatEtag(3)).toBe('"3"');
  });
  it("missing header is 428", () => {
    expect(() => parseIfMatch({})).toThrow(PreconditionRequiredError);
  });
  it.each(["3", '"x"', '"3" ', 'W/"3"', '""', '"1234567890"', "*"])("malformed %s is 400", (raw) => {
    expect(() => parseIfMatch({ "if-match": raw })).toThrow(BadRequestError);
  });
  it("a repeated header is malformed, not silently the first value", () => {
    expect(() => parseIfMatch({ "if-match": ['"1"', '"2"'] as unknown as string })).toThrow(BadRequestError);
  });
  it("a stale version is 412 and a current one passes", () => {
    expect(() => {
      assertVersion(4, 3);
    }).toThrow(PreconditionFailedError);
    expect(() => {
      assertVersion(3, 3);
    }).not.toThrow();
  });
});
