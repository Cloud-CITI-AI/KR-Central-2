import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createJob } from "./harness/jobs";
import { STAFF } from "./harness/users";
import { decisionLetter, pdfFile } from "./support/documents";
import { card, openTracker } from "./support/tracker";

// PRODUCT_SPEC §12 (responsive: no horizontal scroll, labels visible and not overlapping at 520 px and below). Each test measures
// what the browser laid out.

/** The page scrolls sideways when the document is wider than the window. */
async function expectNoHorizontalScroll(page: Page, what: string): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${what}: the page is ${scrollWidth.toString()} px wide in a ${clientWidth.toString()} px window`,
  ).toBe(clientWidth);
}

/** The box that the text of an element actually occupies (it can spill out of the element's own box). */
function textBox(locator: Locator): Promise<{ left: number; right: number; top: number; bottom: number }> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const { left, right, top, bottom } = range.getBoundingClientRect();
    return { left, right, top, bottom };
  });
}

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an excluded stage's name and its 'Not required' label do not overlap or wrap the name", async ({
    page,
    signInAs,
    apiAs,
  }) => {
    const staff = await apiAs(STAFF);
    const job = await createJob(staff);
    const letter = await decisionLetter("Decision Letter.pdf", [
      { text: "Underground power being provided to every lot.", agency: "Western Power" },
    ]);
    await staff.upload(
      job.id,
      { checkpointKey: "i5_0", slot: "decision" },
      { name: letter.name, bytes: letter.buffer, type: letter.mimeType },
    );
    await signInAs(STAFF);
    await openTracker(page, job.id);
    const approval = card(page, "i5_0");
    await approval.getByRole("button", { name: "Extract conditions from Decision Letter" }).click();
    await expect(approval.getByText("1 condition extracted")).toBeVisible();

    const bar = page.getByTitle("The Decision Letter has no conditions for Busselton Water");
    await expect(bar).toContainText("Not required");
    const name = await textBox(bar.getByText("Busselton Water", { exact: true }));
    const label = await textBox(bar.getByText(/^Not required/));
    const apart =
      name.right <= label.left || label.right <= name.left || name.bottom <= label.top || label.bottom <= name.top;
    expect(apart, `the name ${JSON.stringify(name)} and the label ${JSON.stringify(label)} overlap`).toBe(true);
    // One line: "BUSSELTON WATER" does not wrap onto a second line inside its box (17 px type, 1.5 line height).
    expect(name.bottom - name.top).toBeLessThan(30);
    await expectNoHorizontalScroll(page, "tracker with an excluded stage");
  });

  for (const width of [390, 320]) {
    test(`a 98-character unbroken file name does not make the tracker scroll sideways at ${width.toString()} px`, async ({
      page,
      signInAs,
      apiAs,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      const staff = await apiAs(STAFF);
      const job = await createJob(staff);
      const file = await pdfFile(`${"x".repeat(94)}.pdf`);
      expect(file.name).toHaveLength(98);
      await staff.upload(
        job.id,
        { checkpointKey: "i2_0", slot: "survey" },
        { name: file.name, bytes: file.buffer, type: file.mimeType },
      );
      await signInAs(STAFF);
      await openTracker(page, job.id);
      await expect(card(page, "i2_0").getByRole("button", { name: file.name, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, "tracker with a 98-character file name");
    });
  }
});
