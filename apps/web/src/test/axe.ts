import axe from "axe-core";
import { expect } from "vitest";

/**
 * Fails when axe finds any violation in `container`. jsdom has no layout, so colour contrast is checked in the
 * Playwright axe scans (e2e) instead; `region` is off because fragments are not whole pages.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const { violations } = await axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
  });
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`)).toEqual([]);
}
