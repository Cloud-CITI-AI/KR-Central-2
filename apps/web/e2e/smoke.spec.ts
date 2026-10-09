import { expect, test } from "@playwright/test";

// Scaffold smoke test: the built app serves the shell. WP-19 replaces this with the full e2e suite and harness.
test("serves the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "KR Surveys Subdivision Tracker" })).toBeVisible();
});
