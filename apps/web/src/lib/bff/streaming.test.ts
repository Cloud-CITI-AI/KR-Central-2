import { describe, expect, it } from "vitest";
import { isStreamingRequest } from "./streaming";

describe("isStreamingRequest", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("is true for the upload, file content and package routes only", () => {
    expect(isStreamingRequest("POST", `/v1/jobs/${id}/files`)).toBe(true);
    expect(isStreamingRequest("GET", `/v1/files/${id}/content`)).toBe(true);
    expect(isStreamingRequest("GET", `/v1/jobs/${id}/package`)).toBe(true);
    expect(isStreamingRequest("GET", `/v1/jobs/${id}`)).toBe(false);
    expect(isStreamingRequest("GET", `/v1/jobs/${id}/files`)).toBe(false);
    expect(isStreamingRequest("GET", `/v1/files/${id}`)).toBe(false);
    expect(isStreamingRequest("DELETE", `/v1/files/${id}`)).toBe(false);
  });
});
