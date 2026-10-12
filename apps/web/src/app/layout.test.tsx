// @vitest-environment node
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

const incoming = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(incoming.headers) }));
vi.mock("@/lib/fonts", () => ({ yantramanav: { style: { fontFamily: "'Yantramanav', 'Yantramanav Fallback'" } } }));

import RootLayout, { metadata } from "./layout";

const render = async () => renderToStaticMarkup(await RootLayout({ children: <p>Page</p> }));

describe("RootLayout", () => {
  it("is en-AU and sets the Yantramanav font stack on the --font-sans token", async () => {
    incoming.headers = new Headers();
    const html = await render();
    expect(html).toContain('<html lang="en-AU"');
    expect(html).toContain(
      "--font-sans:&#x27;Yantramanav&#x27;, &#x27;Yantramanav Fallback&#x27;, &quot;Segoe UI&quot;",
    );
    expect(html).toContain("<p>Page</p>");
  });

  it("inlines the theme bootstrap with the request nonce, unescaped", async () => {
    incoming.headers = new Headers({ "x-nonce": "n0nce123" });
    const html = await render();
    expect(html).toContain(`<script nonce="n0nce123">${THEME_BOOTSTRAP_SCRIPT}</script>`);
  });

  it("preloads the header's hero photo (the LCP element) at the size the stylesheet will pick, AVIF, high priority", async () => {
    incoming.headers = new Headers();
    const html = await render();
    const css = readFileSync(new URL("../components/ui/AppHeader.module.css", import.meta.url), "utf8");
    for (const [width, media] of [
      ["1280", "(min-width: 641px)"],
      ["640", "(max-width: 640px)"],
    ] as const) {
      const href = `/brand/hero-header-${width}.avif`;
      const link = html.split("<link").find((tag) => tag.includes(`href="${href}"`)) ?? "";
      expect(link, href).toContain('rel="preload"');
      expect(link).toContain('as="image"');
      expect(link).toContain('type="image/avif"');
      expect(link).toContain(`media="${media}"`);
      expect(link.toLowerCase()).toContain('fetchpriority="high"');
      expect(css, "the stylesheet asks for the file that is preloaded").toContain(`url("${href}") type("image/avif")`);
    }
  });

  it("titles pages with the product name", () => {
    expect(metadata.title).toMatchObject({ default: "KR Surveys Subdivision Tracker" });
  });
});
