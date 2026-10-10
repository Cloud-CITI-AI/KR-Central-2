import { expect, test } from "../fixtures";
import { createJob } from "../harness/jobs";
import { STAFF } from "../harness/users";
import { violationsOn } from "../support/a11y";
import { decisionLetter } from "../support/documents";
import { card, openTracker } from "../support/tracker";

// Tracking: there are no issues yet, so the defect ids D1 to D7 reported to the orchestrator under WP-19 stand in for them (each
// `test.fail` reason below carries its id). Every test here asserts what the spec says and is marked as expected to fail, so the
// run stays green while the defect stands and goes red the day it is fixed ("expected to fail, but passed"): then delete its
// `test.fail` line (and for D6 and D7 their colour pairs in `KNOWN_CONTRAST_PAIRS`, support/a11y.ts).

// Colour contrast (formerly known defect D3): the secondary text colours of the tokens meet 4.5:1 (WCAG 2.2 AA, 1.4.3) on every
// surface they sit on, so axe's colour-contrast rule is held to the whole rule here and in states.spec.ts, in both themes.
for (const theme of ["light", "dark"] as const) {
  for (const surface of ["dashboard", "tracker"] as const) {
    test(`D3: colour contrast meets WCAG 2.2 AA on the ${theme} ${surface}`, async ({ page, signInAs, apiAs }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("kr-theme", value);
      }, theme);
      const job = await createJob(await apiAs(STAFF));
      await signInAs(STAFF);
      if (surface === "dashboard") await page.goto("/");
      else await openTracker(page, job.id);
      await page.waitForLoadState("networkidle");
      expect(await violationsOn(page, { only: ["color-contrast"] })).toEqual([]);
    });
  }
}

// Known product defect D6 (WP-19, found when the contrast carve-out was narrowed to D3): the pressed dashboard filter chip's count
// sits on a translucent overlay over the accent: white on #d0774c (3.26:1) in the light theme, #151514 on #ba5d2e (4.07:1) in the
// dark. axe reports this node only on some runs (it is absent from a quiet one), so this test measures the ratio itself from the
// computed colours instead of asking axe. Expected to fail until fixed.
for (const theme of ["light", "dark"] as const) {
  test(`D6: the pressed dashboard filter chip's count meets 4.5:1 contrast in the ${theme} theme`, async ({
    page,
    signInAs,
    apiAs,
  }) => {
    test.fail(
      true,
      "WP-19 defect D6: pressed chip count is white on #d0774c (3.26) or #151514 on #ba5d2e (4.07), see the comment above",
    );
    await createJob(await apiAs(STAFF));
    await page.addInitScript((value) => {
      localStorage.setItem("kr-theme", value);
    }, theme);
    await signInAs(STAFF);
    await page.goto("/");
    const chip = page.getByRole("button", { name: /^All types/ });
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip.locator("span")).toHaveText(/^\d+$/);
    const ratio = await chip.locator("span").evaluate((count) => {
      const parse = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
      const [br = 0, bg = 0, bb = 0] = parse(getComputedStyle(count.parentElement as Element).backgroundColor);
      const [or = 0, og = 0, ob = 0, oa = 1] = parse(getComputedStyle(count).backgroundColor);
      const [fr = 0, fg = 0, fb = 0] = parse(getComputedStyle(count).color);
      const mix = (under: number, over: number): number => over * oa + under * (1 - oa);
      const luminance = (rgb: number[]): number => {
        const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const back = luminance([mix(br, or), mix(bg, og), mix(bb, ob)]);
      const front = luminance([fr, fg, fb]);
      return (Math.max(back, front) + 0.05) / (Math.min(back, front) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}

// Known product defect D7 (WP-19, same discovery): on the conditions checklist the orange agency and "WAPC approval" links
// (#d65614 on white, 4.03:1, and on the red tint #fce8e6, 3.42:1, at 12.5px) fail contrast in the light theme. Expected to fail until fixed.
test("D7: the orange links on the conditions checklist meet WCAG 2.2 AA contrast", async ({
  page,
  signInAs,
  apiAs,
}) => {
  test.fail(
    true,
    "WP-19 defect D7: orange links are #d65614 on white or the red tint, 3.4 to 4.0:1 (see the comment above)",
  );
  const staff = await apiAs(STAFF);
  const job = await createJob(staff);
  const letter = await decisionLetter("Decision Letter.pdf", [
    { text: "Underground power being provided to every lot.", agency: "Western Power" },
    { text: "Drainage plans being approved.", agency: "City of Stirling" },
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
  await expect(approval.getByText("2 conditions extracted")).toBeVisible();
  expect(await violationsOn(page, { onlyKnown: "D7" })).toEqual([]);
});
