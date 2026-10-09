import { PDFDocument } from "pdf-lib";
import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { surfaceLuminance, card, tabTo } from "../support/tracker";

// PRODUCT_SPEC §12: dark mode, keyboard use, and the print stylesheet ("Save as PDF").

test("the theme control switches between light and dark, follows the OS on System, and is remembered", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/jobs/${job.id}`);
  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  expect(await surfaceLuminance(page)).toBeGreaterThan(0.6);

  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await surfaceLuminance(page)).toBeLessThan(0.3);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

  await theme.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await surfaceLuminance(page)).toBeGreaterThan(0.6);

  // System follows the operating system again, with no attribute on <html>.
  await theme.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await surfaceLuminance(page)).toBeLessThan(0.3);
});

test("a checkpoint can be opened and updated with the keyboard alone, with a visible focus ring", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Collapse all" }).click();

  const preliminaries = page.getByRole("button", { name: "Preliminaries" });
  await tabTo(page, preliminaries);
  await expect(preliminaries).toBeFocused();
  await expect(preliminaries).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(preliminaries).toHaveAttribute("aria-expanded", "true");

  const completed = card(page, "i2_0").getByRole("button", { name: "Completed", exact: true });
  await tabTo(page, completed);
  const ring = await completed.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Space");
  await expect(completed).toHaveAttribute("aria-pressed", "true");

  const responsibility = card(page, "i2_0").getByRole("combobox", { name: "Responsibility for 2.0" });
  await tabTo(page, responsibility);
  await page.keyboard.press("ArrowDown");
  await expect(responsibility).not.toHaveValue("kr");
  await expect(page.getByText("2%", { exact: true }).first()).toBeVisible();
});

test("the tracker prints on A4 with the controls, drop zones and stage bars set for paper", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Save as PDF" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Expand all" })).toBeHidden();
  // Every stage prints open, even the ones collapsed on screen.
  await expect(card(page, "i13_2")).toBeVisible();
  await expect(page.getByText("Drag and drop the feature survey PDF and DWG here")).toBeHidden();

  const pdf = await page.pdf({ format: "A4", printBackground: true });
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const document = await PDFDocument.load(pdf);
  expect(document.getPageCount()).toBeGreaterThan(2);
  const { width, height } = document.getPage(0).getSize();
  // A4 is 595.28 x 841.89 pt; Chromium writes it rounded up.
  expect(Math.abs(width - 595.28)).toBeLessThan(1.5);
  expect(Math.abs(height - 841.89)).toBeLessThan(1.5);
});

test("Save as PDF opens every stage for the print dialog and puts them back afterwards", async ({
  page,
  signInAs,
  apiAs,
}) => {
  const job = await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  await page.goto(`/jobs/${job.id}`);
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.evaluate(() => {
    const seen: number[] = [];
    Object.assign(window, { printed: seen });
    window.print = () => {
      seen.push(document.querySelectorAll('button[aria-expanded="true"]').length);
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.getByRole("button", { name: "Save as PDF" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number[] }).printed)).toEqual([10]);
  await expect(page.locator('section button[aria-expanded="true"]')).toHaveCount(0);
});
