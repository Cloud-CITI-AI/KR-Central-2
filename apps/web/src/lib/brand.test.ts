// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url));

describe("brand assets", () => {
  it.each(["640", "1280"].flatMap((width) => ["avif", "webp"].map((format) => `hero-header-${width}.${format}`)))(
    "public/brand/%s is identical to the design-tokens asset it copies",
    (name) => {
      expect(read(`../../public/brand/${name}`).equals(read(`../../../../packages/design-tokens/assets/${name}`))).toBe(
        true,
      );
    },
  );

  it("public/brand/kr-surveys-logo.svg is identical to the design-tokens asset it copies", () => {
    expect(
      read("../../public/brand/kr-surveys-logo.svg").equals(
        read("../../../../packages/design-tokens/assets/kr-surveys-logo.svg"),
      ),
    ).toBe(true);
  });
});
