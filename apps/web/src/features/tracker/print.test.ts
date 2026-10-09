import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = (name: string) => readFileSync(join(__dirname, name), "utf8");
/** The text of every `@media print { … }` block in a stylesheet. */
const printRules = (name: string) =>
  [...css(name).matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((match) => match[1] ?? "").join("\n");

describe("print stylesheet (§12)", () => {
  it("opens every stage, drops the Expand/Collapse row and keeps cards whole", () => {
    const rules = printRules("Stages.module.css");
    expect(rules).toMatch(/\.body\[hidden\]\s*\{\s*display: block;/);
    expect(rules).toMatch(/\.tools\s*\{\s*display: none;/);
    expect(rules).toMatch(/\.item\s*\{\s*break-inside: avoid;/);
  });

  it("keeps the summary panels and the outcome box whole and hides the reset link", () => {
    expect(printRules("SummaryPanels.module.css")).toMatch(/break-inside: avoid;/);
    const outcome = printRules("OutcomeBox.module.css");
    expect(outcome).toMatch(/\.outcome\s*\{\s*break-inside: avoid;/);
    expect(outcome).toMatch(/\.reset\s*\{\s*display: none;/);
  });

  it("sets A4 portrait and hides anything marked .no-pdf", () => {
    expect(css("TrackerBody.module.css")).toMatch(/@page\s*\{\s*size: A4 portrait;/);
    expect(printRules("TrackerBody.module.css")).toMatch(/:global\(\.no-pdf\)\s*\{\s*display: none !important;/);
  });

  it("hides the jobbar buttons and links through the shared Button style", () => {
    const button = readFileSync(join(__dirname, "../../components/ui/Button.module.css"), "utf8");
    expect(button).toMatch(/@media print \{\s*\.btn \{\s*display: none;/);
  });
});
