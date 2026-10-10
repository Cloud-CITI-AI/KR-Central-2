import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** The WCAG 2.2 AA rule sets (PRODUCT_SPEC §12): A and AA of 2.0, 2.1 and 2.2. */
const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** One foreground/background pair of colours, as axe reports them (lower-case hex). */
export interface ColourPair {
  readonly fg: string;
  readonly bg: string;
}

/** The known product defects that are about colour contrast. Tracking: the ids reported to the orchestrator under WP-19. */
export type ContrastDefect = "D6" | "D7";

/**
 * The exact colour pairs of each known contrast defect (e2e/a11y/known-defects.spec.ts has one expected-to-fail test per defect).
 * Only nodes whose pair is listed here are tolerated; any other low-contrast pair fails the state it appears in.
 *
 * D6: the pressed filter chip's count (axe reports it only on some runs). D7: the orange "up" links on the
 * conditions checklist (agency and WAPC approval links) in the light theme.
 */
export const KNOWN_CONTRAST_PAIRS: Readonly<Record<ContrastDefect, readonly ColourPair[]>> = {
  D6: [
    { fg: "#ffffff", bg: "#d0774c" },
    { fg: "#151514", bg: "#ba5d2e" },
  ],
  D7: [
    { fg: "#d65614", bg: "#fce8e6" },
    { fg: "#d65614", bg: "#ffffff" },
  ],
};

interface AxeColourData {
  fgColor?: string;
  bgColor?: string;
}
interface AxeNode {
  target: unknown[];
  failureSummary?: string;
  any: { data?: unknown }[];
}

function pairOf(node: AxeNode): ColourPair | undefined {
  for (const check of node.any) {
    const data = check.data as AxeColourData | undefined;
    if (data?.fgColor && data.bgColor) return { fg: data.fgColor.toLowerCase(), bg: data.bgColor.toLowerCase() };
  }
  return undefined;
}

/** The known contrast defect (if any) whose documented pairs include the node's colours. */
export function knownDefectOf(node: AxeNode): ContrastDefect | undefined {
  const pair = pairOf(node);
  if (!pair) return undefined;
  return (Object.keys(KNOWN_CONTRAST_PAIRS) as ContrastDefect[]).find((defect) =>
    KNOWN_CONTRAST_PAIRS[defect].some((known) => known.fg === pair.fg && known.bg === pair.bg),
  );
}

/**
 * Rule ids axe reports for a page, with what is wrong and where, in a form that reads in a failing test report.
 * `onlyKnown` keeps just the colour-contrast nodes of one known defect (its expected-to-fail test asserts there are none);
 * `ignoreKnown` drops the nodes of every known contrast defect and keeps everything else, including any other contrast failure.
 */
export async function violationsOn(
  page: Page,
  rules?: { only?: string[]; except?: string[]; ignoreKnown?: boolean; onlyKnown?: ContrastDefect },
): Promise<string[]> {
  let axe = new AxeBuilder({ page }).withTags(WCAG_22_AA);
  if (rules?.except) axe = axe.disableRules(rules.except);
  const { violations } = await axe.analyze();
  return violations
    .filter((violation) => !rules?.only || rules.only.includes(violation.id))
    .map((violation) => {
      const nodes: AxeNode[] =
        violation.id !== "color-contrast"
          ? violation.nodes
          : violation.nodes.filter((node) => {
              if (rules?.onlyKnown) return knownDefectOf(node) === rules.onlyKnown;
              if (rules?.ignoreKnown) return knownDefectOf(node) === undefined;
              return true;
            });
      if (rules?.onlyKnown && violation.id !== "color-contrast") return undefined;
      if (nodes.length === 0) return undefined;
      const where = nodes.map((node) => {
        const pair = violation.id === "color-contrast" ? pairOf(node) : undefined;
        const colours = pair ? ` [${pair.fg} on ${pair.bg}]` : "";
        return `    ${node.target.join(" ")}${colours}\n      ${node.failureSummary ?? ""}`;
      });
      return `${violation.id} (${violation.impact ?? "n/a"}): ${violation.help}\n${where.join("\n")}`;
    })
    .filter((line): line is string => line !== undefined);
}

/**
 * Soft-asserts that the page as it is now has no WCAG 2.2 AA violations (zero is the only acceptable count), naming the
 * state in the report so one run lists every state that fails. Colour contrast stays on: only the nodes whose colour pair is one
 * of the documented pairs of a known defect (`KNOWN_CONTRAST_PAIRS`) are tolerated, and e2e/a11y/known-defects.spec.ts turns red
 * when such a defect is fixed (then delete its pairs). `alsoExcept` names another rule that one state fails because of a known defect (D4), so the rest
 * of that state is still checked.
 */
export async function expectAccessible(page: Page, state: string, alsoExcept: string[] = []): Promise<void> {
  const violations = await violationsOn(page, { except: alsoExcept, ignoreKnown: true });
  expect.soft(violations, `WCAG 2.2 AA violations: ${state}`).toEqual([]);
}
