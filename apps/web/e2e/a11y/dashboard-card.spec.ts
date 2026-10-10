import { expect, test } from "../fixtures";
import { createJob, uniqueJobNumber } from "../harness/jobs";
import { STAFF } from "../harness/users";

// A job card on the dashboard (PRODUCT_SPEC §6) honours reduced motion and never makes the page scroll sideways (§12).

test("the progress segments of a card do not animate when the person prefers reduced motion", async ({
  page,
  signInAs,
  apiAs,
}) => {
  await createJob(await apiAs(STAFF));
  await signInAs(STAFF);
  const segments = () => page.getByRole("article").first().getByRole("img").locator("i");
  const transitions = () =>
    segments().evaluateAll((elements) => elements.map((e) => getComputedStyle(e).transitionDuration));

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(segments()).toHaveCount(3);
  expect(await transitions()).toEqual(["0.4s", "0.4s", "0.4s"]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(segments()).toHaveCount(3);
  expect(await transitions()).toEqual(["0s", "0s", "0s"]);
});

for (const width of [320, 390, 1280]) {
  test(`a client name without spaces wraps inside its card at ${width.toString()} px: no horizontal scroll`, async ({
    page,
    signInAs,
    apiAs,
  }) => {
    const jobNumber = uniqueJobNumber("WRAP");
    await createJob(await apiAs(STAFF), { jobNumber, clientName: "C".repeat(200) });
    await signInAs(STAFF);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search jobs" }).fill(jobNumber);
    const card = page.getByRole("article").filter({ hasText: jobNumber });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("C".repeat(200));
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    const box = await card.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(width);
  });
}
