import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

describe("parseEnv", () => {
  it("parses the API URL (trailing slash removed) and an optional feedback URL", () => {
    expect(parseEnv({ API_INTERNAL_URL: "http://api.railway.internal:8080/" })).toEqual({
      API_INTERNAL_URL: "http://api.railway.internal:8080",
    });
    expect(parseEnv({ API_INTERNAL_URL: "http://a:1", FEEDBACK_URL: "https://forms.example.com/f" }).FEEDBACK_URL).toBe(
      "https://forms.example.com/f",
    );
  });

  it("treats an empty FEEDBACK_URL as unset", () => {
    expect(parseEnv({ API_INTERNAL_URL: "http://a:1", FEEDBACK_URL: "" }).FEEDBACK_URL).toBeUndefined();
  });

  it("fails closed naming the variables, never their values", () => {
    const attempt = () => parseEnv({ API_INTERNAL_URL: "not a url", FEEDBACK_URL: "javascript:alert(1)" });
    expect(attempt).toThrow(EnvError);
    try {
      attempt();
    } catch (error) {
      expect((error as EnvError).variables).toEqual(["API_INTERNAL_URL", "FEEDBACK_URL"]);
      expect((error as EnvError).message).not.toContain("javascript");
    }
    expect(() => parseEnv({})).toThrow(/API_INTERNAL_URL/);
  });
});
