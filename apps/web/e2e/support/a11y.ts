import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The WCAG 2.2 AA rule sets (PRODUCT_SPEC §12): A and AA of 2.0, 2.1 and 2.2. */
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Rule ids axe reports for a page, with what is wrong and where, in a form that reads in a failing test report. */
export async function violationsOn(page: Page, rules?: { only?: string[]; except?: string[] }): Promise<string[]> {
  let axe = new AxeBuilder({ page }).withTags(WCAG_22_AA);
  if (rules?.except) axe = axe.disableRules(rules.except);
  const { violations } = await axe.analyze();
  return violations
    .filter((violation) => !rules?.only || rules.only.includes(violation.id))
    .map((violation) => {
      const where = violation.nodes.map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary ?? ""}`);
      return `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n${where.join("\n")}`;
    });
}

/**
 * Soft-asserts that the page as it is now has no WCAG 2.2 AA violations (zero is the only acceptable count), naming the
 * state in the report so one run lists every state that fails. Colour contrast is left out here because of the known defect D3,
 * which e2e/a11y/known-defects.spec.ts tracks (and turns red when it is fixed). `alsoExcept` names another rule that one state
 * fails because of a known defect (D4), so the rest of that state is still checked.
 */
export async function expectAccessible(page: Page, state: string, alsoExcept: string[] = []): Promise<void> {
  const violations = await violationsOn(page, { except: ["color-contrast", ...alsoExcept] });
  expect.soft(violations, `WCAG 2.2 AA violations: ${state}`).toEqual([]);
}
