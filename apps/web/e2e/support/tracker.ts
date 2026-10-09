import { expect, type Locator, type Page } from "@playwright/test";

/** The card of one checkpoint on the tracker (by storage key, e.g. `i2_0` for 2.0 Site Feature Survey). */
export const card = (page: Page, key: string): Locator => page.locator(`[data-checkpoint="${key}"]`);

/** Open a job's tracker with every stage expanded, ready to be read and driven. */
export async function openTracker(page: Page, jobId: string): Promise<void> {
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "Expand all" }).click();
}

/** The file input of a drop zone inside `scope` (the zone's `<input type=file>` is visually hidden but present). */
export const fileInput = (scope: Locator): Locator => scope.locator('input[type="file"]');

/** The progress ring's percentage text. */
export async function expectProgress(page: Page, percent: number): Promise<void> {
  await expect(page.getByText(`${percent.toString()}%`, { exact: true }).first()).toBeVisible();
}

/**
 * Luminance (0 dark, 1 light) of the cards' surface colour (the `--surface` token), to tell the light and dark themes apart
 * without hard-coding the palette. The page background itself is a mid grey in the light theme (the prototype's look).
 */
export async function surfaceLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--surface)";
    document.body.append(probe);
    const [r = 0, g = 0, b = 0] = getComputedStyle(probe)
      .backgroundColor.split(/[^\d.]+/)
      .filter(Boolean)
      .map(Number);
    probe.remove();
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
}

/** Press Tab until `target` has focus (keyboard-only navigation), failing after `limit` presses. */
export async function tabTo(page: Page, target: Locator, limit = 400): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab did not reach the target in ${limit.toString()} presses`);
}
