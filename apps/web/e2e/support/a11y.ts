import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The WCAG 2.2 AA rule sets (PRODUCT_SPEC §12): A and AA of 2.0, 2.1 and 2.2. */
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface AxeColourData {
  fgColor?: string;
  bgColor?: string;
}
interface AxeNode {
  target: unknown[];
  failureSummary?: string;
  any: { data?: unknown }[];
}

/** The foreground and background colours axe measured for a colour-contrast node (lower-case hex), when it reports them. */
function colours(node: AxeNode): string | undefined {
  for (const check of node.any) {
    const data = check.data as AxeColourData | undefined;
    if (data?.fgColor && data.bgColor) return ` [${data.fgColor.toLowerCase()} on ${data.bgColor.toLowerCase()}]`;
  }
  return undefined;
}

/** Rule ids axe reports for a page, with what is wrong and where, in a form that reads in a failing test report. */
export async function violationsOn(page: Page, rules?: { only?: string[]; except?: string[] }): Promise<string[]> {
  let axe = new AxeBuilder({ page }).withTags(WCAG_22_AA);
  if (rules?.except) axe = axe.disableRules(rules.except);
  const { violations } = await axe.analyze();
  return violations
    .filter((violation) => !rules?.only || rules.only.includes(violation.id))
    .map((violation) => {
      const where = (violation.nodes as AxeNode[]).map((node) => {
        const pair = violation.id === "color-contrast" ? colours(node) : undefined;
        return `    ${node.target.join(" ")}${pair ?? ""}\n      ${node.failureSummary ?? ""}`;
      });
      return `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n${where.join("\n")}`;
    });
}

/**
 * Soft-asserts that the page as it is now has no WCAG 2.2 AA violations (zero is the only acceptable count, colour contrast
 * included), naming the state in the report so one run lists every state that fails.
 */
export async function expectAccessible(page: Page, state: string): Promise<void> {
  expect.soft(await violationsOn(page), `WCAG 2.2 AA violations: ${state}`).toEqual([]);
}
