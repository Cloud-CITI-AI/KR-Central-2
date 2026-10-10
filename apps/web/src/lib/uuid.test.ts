import { Uuid } from "@kr/contracts";
import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it.each([
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "018f2f1e-8f3a-7c3e-9b1d-5f2a4c6d8e90",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "0F8FAD5B-D9CB-469F-A165-70867728950E",
    "0f8fad5b-d9cb-069f-a165-70867728950e",
    "0f8fad5b-d9cb-469f-c165-70867728950e",
    "0f8fad5b-d9cb-469f-a165-70867728950",
    "0f8fad5bd9cb469fa16570867728950e",
    " 0f8fad5b-d9cb-469f-a165-70867728950e",
    "S-0001",
    "",
    null,
    undefined,
    42,
  ])("agrees with the contract's Uuid for %j", (value) => {
    expect(isUuid(value)).toBe(Uuid.safeParse(value).success);
  });
});
