import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WP-03 shell checks (ADR-0005 compliance: "Header tests in e2e"; FE-8, FE-13). WP-19 owns the full journeys.

const THEMES = ["light", "dark"] as const;
const PUBLIC_PAGES = ["/sign-in", "/sign-in-error?reason=wrong_tenant", "/signed-out"] as const;

async function chooseTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((value) => {
    localStorage.setItem("kr-theme", value);
  }, theme);
}

test.describe("security headers on /sign-in", () => {
  test("sends the nonce CSP that ADR-0005 specifies, and the nonce is in the page", async ({ request }) => {
    const response = await request.get("/sign-in");
    expect(response.status()).toBe(200);
    const csp = response.headers()["content-security-policy"] ?? "";
    const nonce = /script-src [^;]*'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(await response.text()).toContain(`nonce="${nonce}"`);
    const again = await request.get("/sign-in");
    expect(again.headers()["content-security-policy"]).not.toBe(csp);
  });

  test("sends HSTS, nosniff, frame and referrer headers and a request id", async ({ request }) => {
    const headers = (await request.get("/sign-in")).headers();
    expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
    expect(headers["x-request-id"]).toMatch(/\S+/);
  });
});

test("redirects a signed-out visitor to sign-in, keeping the page they wanted", async ({ request }) => {
  const response = await request.get("/jobs/1?a=b", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location ?? "", "http://localhost");
  expect(location.pathname + location.search).toBe("/sign-in?returnTo=%2Fjobs%2F1%3Fa%3Db");
});

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    for (const path of PUBLIC_PAGES) {
      test(`${path} has no serious or critical accessibility violations`, async ({ page }) => {
        await chooseTheme(page, theme);
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      });
    }
  });
}

test("the Dark theme choice survives a reload", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
});

test("/api/healthz answers ok without the API", async ({ request }) => {
  const response = await request.get("/api/healthz");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
