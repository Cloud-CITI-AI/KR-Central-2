import { screen } from "@testing-library/react";
import { syntheticConditionJob } from "./test-fixtures";

/** The checklist card of condition `number`. */
export const checklistCard = (number: number) => screen.getByRole("group", { name: `Condition ${number}` });

/** Three conditions for three agencies: the second is cleared, the third has a guessed agency; they came from a Decision Letter. */
export function threeConditions(options: Parameters<typeof syntheticConditionJob>[0] = {}) {
  return syntheticConditionJob({
    agencies: ["Western Power", "Water Corporation", "WAPC"],
    conditions: [{}, { isCleared: true }, { agencyGuessed: true }],
    fields: {
      conditionsSource: {
        fileId: "0c4e2a52-6a4b-4b8e-9d65-2f0a4f6f1b11",
        fileName: "Decision Letter.pdf",
        extractedAt: "2026-09-28T03:50:56.543Z",
      },
    },
    ...options,
  });
}
