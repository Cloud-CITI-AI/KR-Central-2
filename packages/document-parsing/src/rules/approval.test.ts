import { describe, expect, it } from "vitest";
import { findApprovalDates } from "./approval.js";

const head = ["Western Australian Planning Commission", "Subdivision approval", "Our ref: 12345"];

describe("findApprovalDates (PRODUCT_SPEC §10.2)", () => {
  it.each([
    ["close of business", "This approval will lapse at close of business on 12 March 2029.", "2029-03-12"],
    ["close of business, numeric date", "Valid until close of business on 12/03/2029.", "2029-03-12"],
    ["no longer be valid", "The approval will no longer be valid after 14 June 2028.", "2028-06-14"],
    ["expires", "This approval expires on 3 September 2027.", "2027-09-03"],
    ["expiry", "Expiry date: 3/9/2027", "2027-09-03"],
    ["EXPIRES in capitals", "EXPIRES 3 SEPTEMBER 2027", "2027-09-03"],
  ])("expiry from %s", (_name, sentence, expiry) => {
    expect(findApprovalDates([...head, "14 March 2026", sentence])).toEqual({
      approvalDate: "2026-03-14",
      approvalExpiry: expiry,
    });
  });

  it("prefers 'close of business' over the other sentences", () => {
    const lines = [...head, "14 March 2026", "expires 1 January 2040", "close of business on 12 March 2029."];
    expect(findApprovalDates(lines).approvalExpiry).toBe("2029-03-12");
  });

  it.each([
    ["valid for two (2) years", "2028-03-14"],
    ["valid for 2 years", "2028-03-14"],
    ["valid for two years", "2028-03-14"],
    ["valid for three years", "2029-03-14"],
    ["valid for one year", "2027-03-14"],
    ["valid for 4 years", "2030-03-14"],
  ])("expiry = approval date + %s", (sentence, expiry) => {
    expect(
      findApprovalDates([...head, "14 March 2026", `This approval is ${sentence} from the date of this letter.`]),
    ).toEqual({
      approvalDate: "2026-03-14",
      approvalExpiry: expiry,
    });
  });

  it("rolls 29 February approvals over like the prototype", () => {
    expect(findApprovalDates(["29/02/2028", "valid for two years"]).approvalExpiry).toBe("2030-03-01");
  });

  it("takes the approval date from the first 40 lines only", () => {
    const lines = [
      ...Array.from({ length: 40 }, () => "text"),
      "1 January 2026",
      "close of business on 2 February 2029",
    ];
    expect(findApprovalDates(lines)).toEqual({ approvalDate: null, approvalExpiry: "2029-02-02" });
  });

  it("ignores an expiry date that is not a real date and falls back to 'valid for'", () => {
    const lines = ["14 March 2026", "close of business on 31 February 2029", "valid for two years"];
    expect(findApprovalDates(lines)).toEqual({ approvalDate: "2026-03-14", approvalExpiry: "2028-03-14" });
  });

  it("does not guess an expiry without an approval date", () => {
    expect(findApprovalDates(["valid for two years"])).toEqual({ approvalDate: null, approvalExpiry: null });
  });

  it("returns only approval and expiry (the outcome date comes from the conformed date)", () => {
    const result = findApprovalDates([...head, "14 March 2026", "Outcome date 1 June 2026"]);
    expect(Object.keys(result).sort()).toEqual(["approvalDate", "approvalExpiry"]);
    expect(result.approvalExpiry).toBeNull();
  });

  it("returns nulls for an empty document", () => {
    expect(findApprovalDates([])).toEqual({ approvalDate: null, approvalExpiry: null });
  });
});
