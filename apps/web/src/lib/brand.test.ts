// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url));

/**
 * The design-tokens assets, found from the workspace root (the folder with pnpm-workspace.yaml) rather than a fixed
 * `../../../../`: Stryker runs this test from a sandbox copy of apps/web (`.stryker-tmp/sandbox-*`), two levels deeper.
 */
function designTokenAsset(name: string): Buffer {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found above this test");
    dir = parent;
  }
  return readFileSync(join(dir, "packages", "design-tokens", "assets", name));
}

describe("brand assets", () => {
  it.each(["640", "1280"].flatMap((width) => ["avif", "webp"].map((format) => `hero-header-${width}.${format}`)))(
    "public/brand/%s is identical to the design-tokens asset it copies",
    (name) => {
      expect(read(`../../public/brand/${name}`).equals(designTokenAsset(name))).toBe(true);
    },
  );

  it("public/brand/kr-surveys-logo.svg is identical to the design-tokens asset it copies", () => {
    expect(read("../../public/brand/kr-surveys-logo.svg").equals(designTokenAsset("kr-surveys-logo.svg"))).toBe(true);
  });
});
