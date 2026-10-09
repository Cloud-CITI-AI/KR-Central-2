// @vitest-environment node
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

  it("titles pages with the product name", () => {
    expect(metadata.title).toMatchObject({ default: "KR Surveys Subdivision Tracker" });
  });
});
