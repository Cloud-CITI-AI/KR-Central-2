import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, isolatedStackTest } from "../fixtures";
import { REPO_ROOT, WEB_DIR } from "../harness/constants";
import { createJob } from "../harness/jobs";
import { KR_ADMIN } from "../harness/users";
import { diffImages } from "../support/image-diff";
import { renderChecklist, type ParityResult } from "./checklist";
import { VIEWS } from "./views";

// Prototype parity (report only): the prototype's blank demo state (job DEMO-000 "Blank demo job", Survey-Strata, nothing set), with
// synthetic data, is photographed the way docs/reference/prototype/screenshots/blank-*.png were, and each picture is compared with the
// prototype's. Nothing here fails on a difference: the diff ratio, a side-by-side image (prototype | app | difference in red) and a
// checklist for the human sign-off are the output. They are attached to each test and written to test-results/parity/;
// PARITY_UPDATE_CHECKLIST=1 writes the checklist to e2e/parity/CHECKLIST.md, the committed copy.
const test = isolatedStackTest({ label: "parity", seed: true });
test.describe.configure({ mode: "serial" });

const SCREENSHOTS = `${REPO_ROOT}docs/reference/prototype/screenshots/`;
const OUTPUT = `${WEB_DIR}test-results/parity/`;
const results: ParityResult[] = [];
let jobId: string | undefined;

test.afterAll(() => {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(`${OUTPUT}report.json`, JSON.stringify(results, null, 2));
  const checklist = renderChecklist(results);
  writeFileSync(`${OUTPUT}CHECKLIST.md`, checklist);
  if (process.env.PARITY_UPDATE_CHECKLIST)
    writeFileSync(fileURLToPath(new URL("./CHECKLIST.md", import.meta.url)), checklist);
});

for (const device of ["desktop", "mobile"] as const) {
  test.describe(`${device} views`, () => {
    test.use(
      device === "desktop"
        ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    );

    for (const view of VIEWS.filter((candidate) => candidate.device === device)) {
      test(view.file, async ({ page, context, signInAs }, testInfo) => {
        test.setTimeout(90_000);
        const entry = { file: view.file, title: view.title, theme: view.theme, device, expected: view.expected };
        if (!view.capture) {
          results.push({ ...entry, status: "absent" });
          return;
        }
        await page.addInitScript((value) => {
          localStorage.setItem("kr-theme", value);
        }, view.theme);
        const staff = await signInAs(KR_ADMIN);
        jobId ??= (
          await createJob(staff, {
            jobNumber: "DEMO-000",
            address: "Blank demo job",
            clientName: null,
            subdivisionType: "Survey-Strata",
          })
        ).id;
        const actual = await view.capture(page, jobId);
        const reference = readFileSync(`${SCREENSHOTS}${view.file}.png`);
        const scratch = await context.newPage();
        const diff = await diffImages(scratch, reference, actual);
        await scratch.close();

        mkdirSync(OUTPUT, { recursive: true });
        writeFileSync(`${OUTPUT}${view.file}-app.png`, actual);
        writeFileSync(`${OUTPUT}${view.file}-side-by-side.png`, diff.sideBySide);
        await testInfo.attach(`${view.file} side by side (prototype | app | difference)`, {
          body: diff.sideBySide,
          contentType: "image/png",
        });
        results.push({
          ...entry,
          status: "compared",
          ratio: diff.ratio,
          reference: diff.reference,
          actual: diff.actual,
        });
        expect(diff.ratio).toBeGreaterThanOrEqual(0);
      });
    }
  });
}
