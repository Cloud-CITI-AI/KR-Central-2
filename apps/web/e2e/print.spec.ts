import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createJob, patchCheckpoint } from "./harness/jobs";
import { STAFF } from "./harness/users";
import { progressSummary, openTracker } from "./support/tracker";

// PRODUCT_SPEC §12 and DESIGN_TOKENS §6, Print / Save as PDF: white page, header, progress ring, bars and status colours kept,
// the controls hidden. Browsers drop backgrounds when printing unless `print-color-adjust: exact` is set, which took the ring,
// the bars, the tracks and the swatches (and, with the hero's dark background, the white logo and title) off the page. The
// tests emulate print media and read what the browser would paint from the computed style.

const printAdjust = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => getComputedStyle(element).getPropertyValue("print-color-adjust"));

async function expectKept(locator: Locator, what: string): Promise<void> {
  expect(await printAdjust(locator), `${what} keeps its colours in print`).toBe("exact");
}

/** Relative luminance of a computed `rgb()` or `rgba()` colour. */
function luminance(colour: string): number {
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => {
    const c = Number(channel) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

async function printed(page: Page): Promise<void> {
  await page.emulateMedia({ media: "print" });
}

test("print keeps the header, the progress ring, the bars, the stage tracks and the status key in colour", async ({
  page,
  signInAs,
}) => {
  const staff = await signInAs(STAFF);
  const job = await createJob(staff);
  await patchCheckpoint(staff, job.id, "i2_0", { status: "completed" });
  await patchCheckpoint(staff, job.id, "i4_0", { status: "not_required" });
  await openTracker(page, job.id);
  await printed(page);

  const summary = progressSummary(page);
  await expectKept(summary.getByText(/^\d+%$/), "the progress ring");
  const bar = summary.getByRole("img");
  await expectKept(bar, "the stacked bar");
  await expectKept(bar.locator("i").first(), "the completed segment");
  await expectKept(page.locator('[class*="_track"]').first(), "a stage bar's progress track");
  await expectKept(page.locator('[class*="_track"] i').first(), "a stage bar's progress fill");
  await expectKept(
    page.getByRole("region", { name: "Status key" }).locator('[class*="_sw"]').first(),
    "a status swatch",
  );

  // The hero is printed with its dark background (the logo's SURVEYS and the title are white): what is actually painted behind
  // them is that background when it is kept and the white page when it is dropped, and both must read against it.
  const hero = page.getByRole("banner");
  const painted =
    (await printAdjust(hero)) === "exact"
      ? await hero.evaluate((el) => getComputedStyle(el).backgroundColor)
      : "rgb(255, 255, 255)";
  const ink = await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).color);
  expect(contrast(ink, painted), `the title ${ink} on ${painted}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast("rgb(255, 255, 255)", painted), `the logo's white SURVEYS on ${painted}`).toBeGreaterThanOrEqual(4.5);

  // The page itself is white and the header controls are gone.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("group", { name: "Theme" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeHidden();
});

test("print drops the dashboard's filters and search and keeps the job cards", async ({ page, signInAs }) => {
  const staff = await signInAs(STAFF);
  const job = await createJob(staff);
  // The stack is shared: on "/" a new job with nothing to attend to sorts below everyone else's and can fall off the first
  // page of 50, so search for it (the search box is one of the controls print drops).
  await page.goto(`/?q=${job.jobNumber}`);
  await expect(page.getByRole("article", { name: job.jobNumber })).toBeVisible();
  await page.getByRole("button", { name: /^In progress/ }).click();
  await expect(page.getByRole("button", { name: /^In progress/ })).toHaveAttribute("aria-pressed", "true");
  await printed(page);

  await expect(page.getByRole("button", { name: /^In progress/ })).toBeHidden();
  await expect(page.getByRole("button", { name: /^All types/ })).toBeHidden();
  await expect(page.getByRole("searchbox", { name: "Search jobs" })).toBeHidden();
  await expect(page.getByRole("article", { name: job.jobNumber })).toBeVisible();
});

// With backgrounds kept in print, the dark palette (the default for anyone whose OS is dark, PRODUCT_SPEC §12) would print as
// dark cards, panels and tints on the white sheet. Print is always the light palette, whether the dark theme is chosen in the
// app (`kr-theme`) or comes from the OS.
for (const source of ["the saved theme", "the OS setting"] as const) {
  test(`print is white with dark text when dark comes from ${source}`, async ({ page, signInAs }) => {
    const staff = await signInAs(STAFF);
    const job = await createJob(staff);
    await patchCheckpoint(staff, job.id, "i2_0", { status: "completed" });
    if (source === "the saved theme") {
      await page.addInitScript(() => {
        localStorage.setItem("kr-theme", "dark");
      });
    } else await page.emulateMedia({ colorScheme: "dark" });
    await openTracker(page, job.id);

    const surface = page.locator('[class*="_track"]').first(); // a card surface (var(--surface))
    const tint = page.locator('[class*="_bar"][data-state="not_completed"]').first(); // a status tint (var(--red-bg))
    const background = (locator: Locator): Promise<string> =>
      locator.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Sanity: on screen both really are dark, so the print assertions below can fail.
    expect(luminance(await background(surface)), "the card surface on screen").toBeLessThan(0.1);
    expect(luminance(await background(tint)), "the not-completed tint on screen").toBeLessThan(0.1);

    await printed(page); // the media type changes; the OS colour scheme stays as it was
    const printedSurface = await background(surface);
    const printedTint = await background(tint);
    expect(luminance(printedSurface), `card surface ${printedSurface} in print`).toBeGreaterThan(0.8);
    expect(luminance(printedTint), `not-completed tint ${printedTint} in print`).toBeGreaterThan(0.6);
    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(body.background).toBe("rgb(255, 255, 255)");
    expect(luminance(body.color), `body text ${body.color}`).toBeLessThan(0.1);
    const heading = await page
      .getByRole("heading", { level: 2 })
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(contrast(heading, printedTint), `stage heading ${heading} on ${printedTint}`).toBeGreaterThanOrEqual(4.5);
  });
}
