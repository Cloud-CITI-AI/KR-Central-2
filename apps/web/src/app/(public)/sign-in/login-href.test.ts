import { describe, expect, it } from "vitest";
import { loginHref } from "./login-href";

describe("loginHref", () => {
  it("goes to the plain login without a returnTo, whatever the fragment", () => {
    expect(loginHref(undefined)).toBe("/api/v1/auth/login");
    expect(loginHref(undefined, "#checkpoint-i13_2")).toBe("/api/v1/auth/login");
  });

  it("keeps returnTo as it is without a fragment", () => {
    expect(loginHref("/jobs/abc?stage=wapc")).toBe("/api/v1/auth/login?returnTo=%2Fjobs%2Fabc%3Fstage%3Dwapc");
  });

  it("folds the fragment into returnTo", () => {
    expect(loginHref("/jobs/abc", "#checkpoint-i13_2")).toBe(
      "/api/v1/auth/login?returnTo=%2Fjobs%2Fabc%23checkpoint-i13_2",
    );
  });

  it("does not add a second fragment, a malformed one, or one that makes returnTo invalid", () => {
    const base = "/api/v1/auth/login?returnTo=";
    expect(loginHref("/jobs/abc#one", "#two")).toBe(`${base}%2Fjobs%2Fabc%23one`);
    expect(loginHref("/jobs/abc", "checkpoint")).toBe(`${base}%2Fjobs%2Fabc`);
    expect(loginHref("/jobs/abc", `#${"a".repeat(600)}`)).toBe(`${base}%2Fjobs%2Fabc`);
    expect(loginHref("/jobs/abc", "# x")).toBe(`${base}%2Fjobs%2Fabc`);
  });
});
