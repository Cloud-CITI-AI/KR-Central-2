import type { Browser, Page } from "@playwright/test";
import { expect, test } from "../e2e/fixtures";
import type { ApiSession } from "../e2e/harness/api-client";
import { STAFF } from "../e2e/harness/users";
import { card } from "../e2e/support/tracker";
import { BUDGETS, KNOWN_BREACHES, PROFILE, SAMPLES, type Scenario as PerfScenario } from "./budgets";
import { freshTrackerJob, seedDashboard } from "./data";
import { installCollector, readRaw } from "./vitals-collector";
import { judge, summarise, type LayoutShiftEntry, type Vitals } from "./vitals-math";

// PRODUCT_SPEC section 14 / FE-9: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 at p75 on the reference profile (budgets.ts).
// Each sample is a cold load in a new browser context signed in as staff, throttled over CDP, followed by scripted
// interactions whose Event Timing entries give the INP proxy.

/** One cold load: its vitals, and the layout shifts that make up the CLS (kept in the report to find what moved). */
interface Sample {
  readonly vitals: Vitals;
  readonly shifts: readonly LayoutShiftEntry[];
}

interface Scenario {
  readonly name: PerfScenario;
  /** Returns the path to load; runs before throttling starts. */
  readonly prepare: (staff: ApiSession) => Promise<string>;
  readonly ready: (page: Page) => Promise<void>;
  readonly interact: (page: Page) => Promise<void>;
}

const dashboard: Scenario = {
  name: "dashboard",
  prepare: () => Promise.resolve("/"),
  ready: async (page) => {
    await expect(page.getByRole("article").first()).toBeVisible();
  },
  interact: async (page) => {
    const show = page.getByRole("group", { name: "Show" });
    await show.getByRole("button", { name: /^All/ }).click();
    await page.getByRole("searchbox", { name: "Search jobs" }).pressSequentially("pty", { delay: 40 });
    await page.getByRole("searchbox", { name: "Search jobs" }).clear();
    await page
      .getByRole("group", { name: "Subdivision type" })
      .getByRole("button", { name: /^Freehold/ })
      .click();
    await show.getByRole("button", { name: /^In progress/ }).click();
  },
};

const tracker: Scenario = {
  name: "tracker",
  prepare: async (staff) => `/jobs/${await freshTrackerJob(staff)}`,
  ready: async (page) => {
    await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
  },
  interact: async (page) => {
    await page.getByRole("button", { name: "Expand all" }).click();
    const survey = card(page, "i2_0");
    await survey.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(survey.getByRole("button", { name: "Completed", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Collapse all" }).click();
  },
};

async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: PROFILE.latencyMs,
    downloadThroughput: PROFILE.downloadBytesPerSecond,
    uploadThroughput: PROFILE.uploadBytesPerSecond,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuSlowdown });
}

async function sample(
  browser: Browser,
  baseURL: string,
  signIn: (context: Awaited<ReturnType<Browser["newContext"]>>) => Promise<unknown>,
  path: string,
  scenario: Scenario,
): Promise<Sample> {
  const context = await browser.newContext({ baseURL, viewport: PROFILE.viewport });
  try {
    await signIn(context);
    const page = await context.newPage();
    await installCollector(page);
    await throttle(page);
    await page.goto(path, { waitUntil: "load" });
    await scenario.ready(page);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    // LCP is final once the page has settled and before the first input; read it before interacting.
    const lcp = summarise(await readRaw(page)).lcpMs;
    await scenario.interact(page);
    await page.waitForTimeout(500);
    const raw = await readRaw(page);
    return { vitals: { ...summarise(raw), lcpMs: lcp }, shifts: raw.layoutShifts.filter((s) => s.value >= 0.005) };
  } finally {
    await context.close();
  }
}

test.describe("web vitals on the reference profile", () => {
  for (const scenario of [dashboard, tracker]) {
    test(`${scenario.name} is within the LCP, CLS and INP budgets at p75`, async ({
      browser,
      signInAs,
      apiAs,
      baseURL,
    }, testInfo) => {
      const staff = await apiAs(STAFF);
      if (scenario === dashboard) await seedDashboard(staff, 24);
      const samples: Sample[] = [];
      for (let i = 0; i < SAMPLES; i++) {
        const path = await scenario.prepare(staff);
        samples.push(await sample(browser, baseURL ?? "", (context) => signInAs(STAFF, context), path, scenario));
      }
      const ceilings = process.env.PERF_STRICT ? {} : KNOWN_BREACHES[scenario.name];
      const { p75, breaches, reclaimable } = judge(
        samples.map((s) => s.vitals),
        BUDGETS,
        ceilings,
      );
      const report = {
        scenario: scenario.name,
        profile: PROFILE.name,
        budgets: BUDGETS,
        ceilings,
        samples,
        p75,
        breaches,
        reclaimable,
      };
      await testInfo.attach(`web-vitals-${scenario.name}`, {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      process.stdout.write(
        `${scenario.name} [${PROFILE.name}] p75 of ${samples.length}: LCP ${p75.lcpMs?.toFixed(0) ?? "-"} ms, CLS ${p75.cls.toFixed(3)}, INP proxy ${p75.inpMs?.toFixed(0) ?? "-"} ms\n`,
      );
      for (const note of reclaimable) process.stdout.write(`${scenario.name}: ${note}\n`);
      expect(breaches, `${scenario.name} is over its web-vitals budget on ${PROFILE.name}`).toEqual([]);
    });
  }
});
