import { describe, expect, it } from "vitest";
import { AGENCIES } from "@kr/workflow";
import {
  buildBlankPdf,
  buildDecisionLetterPdf,
  buildPdf,
  conditionText,
  syntheticFaker,
} from "../../test/fixtures/builders.js";
import { findApprovalDates } from "../rules/approval.js";
import { parseConditions } from "../rules/conditions.js";
import { pdfTextLines } from "./text.js";

describe("pdfTextLines", () => {
  it("returns one line per drawn line and an empty line after each page", async () => {
    const bytes = await buildPdf({ pages: [["Conditions", "1. First  thing", "", "   2. Second"], ["Page two"]] });
    expect(await pdfTextLines(bytes)).toEqual(["Conditions", "1. First thing", "2. Second", "", "Page two", ""]);
  });

  it("returns only the page break for a blank page", async () => {
    expect(await pdfTextLines(await buildBlankPdf(2))).toEqual(["", ""]);
  });

  it("enforces the page cap", async () => {
    await expect(pdfTextLines(await buildBlankPdf(3), { maxPages: 2 })).rejects.toMatchObject({
      code: "too_many_pages",
    });
  });

  it("feeds the rules: a multi-page letter with footers round-trips through the PDF", async () => {
    const f = syntheticFaker(11);
    const conditions = AGENCIES.flatMap((a) => [
      { text: conditionText(a, f) },
      { text: conditionText(a, f), bracket: a === "Local Government" ? "City of Stirling" : a },
    ]);
    const { bytes, lines } = await buildDecisionLetterPdf(
      {
        letterDate: "14 March 2026",
        conditions,
        adviceNotes: ["Advice only, not a condition."],
        closing: ["This approval will lapse at close of business on 12 March 2029."],
      },
      f,
    );
    const fromPdf = await pdfTextLines(bytes);
    expect(fromPdf.length).toBeGreaterThan(lines.length);
    const parsed = parseConditions(fromPdf);
    expect(parsed.map((c) => c.number)).toEqual(conditions.map((_, i) => i + 1));
    expect(parsed.map((c) => c.agencyGuessed)).toEqual(conditions.map((c) => !("bracket" in c)));
    expect(parsed).toEqual(parseConditions(lines));
    expect(findApprovalDates(fromPdf)).toEqual({ approvalDate: "2026-03-14", approvalExpiry: "2029-03-12" });
  });
});
