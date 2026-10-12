import type { Locator, Page } from "@playwright/test";
import { card } from "../support/tracker";

/** One screenshot of the prototype's blank demo job (docs/reference/prototype/screenshots) and how to take the same picture of the app. */
export interface ParityView {
  /** The prototype's file, without ".png". */
  readonly file: string;
  readonly title: string;
  readonly theme: "light" | "dark";
  readonly device: "desktop" | "mobile";
  /** Where the picture is taken, and of what; `null` for a view the app deliberately does not have. */
  readonly capture: ((page: Page, jobId: string) => Promise<Buffer>) | null;
  /** What is expected to differ from the prototype, for the human sign-off. */
  readonly expected: string;
}

const HEADER =
  "the signed-in header adds the user's name, the Admin link, Sign out and the System / Light / Dark theme control (§12) and the page has no 'Blank demo … exported' banner";
const UPLOAD_LIMIT =
  "the footer says 'up to 50 MB each' where the prototype said 20 MB (early finding 4: to be confirmed against PRODUCT_SPEC)";

async function openJob(page: Page, jobId: string): Promise<void> {
  await page.goto(`/jobs/${jobId}`);
  await page.getByRole("button", { name: "Expand all" }).waitFor();
}
const collapsed = async (page: Page, jobId: string): Promise<void> => {
  await openJob(page, jobId);
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.locator('section button[aria-expanded="true"]').first().waitFor({ state: "detached" });
};
const expanded = async (page: Page, jobId: string): Promise<void> => {
  await openJob(page, jobId);
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.locator('section button[aria-expanded="false"]').first().waitFor({ state: "detached" });
  await page.locator("[id^='body-'][hidden]").first().waitFor({ state: "detached" }); // the bodies appear a stage per frame
};
const stage = (page: Page, index: number): Locator =>
  page.locator("section:has(> h2 > button[aria-expanded])").nth(index);
const whole = (page: Page): Promise<Buffer> => page.screenshot({ fullPage: true });

/** The job page's summary row: the Subdivision progress and Status key panels together. */
const summary = (page: Page): Locator =>
  page
    .locator("div")
    .filter({ has: page.getByRole("region", { name: "Subdivision progress" }) })
    .filter({ has: page.getByRole("region", { name: "Status key" }) })
    .last();

const STAGES = [
  ["stage-01-preliminaries", "Preliminaries"],
  ["stage-02-wapc-approval", "WAPC Approval"],
  ["stage-03-western-power", "Western Power"],
  ["stage-04-water-corporation", "Water Corporation"],
  ["stage-05-local-government", "Local Government"],
  ["stage-06-busselton-water", "Busselton Water"],
  ["stage-07-wapc", "WAPC"],
  ["stage-08-survey", "Survey"],
  ["stage-09-landgate", "Landgate"],
  ["stage-10-titles", "Titles"],
] as const;

export const VIEWS: readonly ParityView[] = [
  {
    file: "blank-01-tracker-collapsed",
    title: "Tracker, every stage collapsed",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return whole(page);
    },
    expected: `${HEADER}; ${UPLOAD_LIMIT}; the Developer notes box is gone (see blank-07)`,
  },
  {
    file: "blank-02-tracker-all-expanded-fullpage",
    title: "Tracker, every stage expanded (full page)",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await expanded(page, jobId);
      return whole(page);
    },
    expected: `${HEADER}; ${UPLOAD_LIMIT}; the Developer notes box is gone (see blank-07); every box has its live drop zone and every stage grows by the drop zones' height (the prototype's demo copy could not upload), so everything below the first stage is offset`,
  },
  {
    file: "blank-03-summary-progress-and-key",
    title: "Subdivision progress and status key",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return summary(page).screenshot();
    },
    expected:
      "none expected beyond font smoothing, the panel's heading underline and the date inputs' placeholder (the browser's locale)",
  },
  {
    file: "blank-04-job-notes",
    title: "Job notes",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return page.getByRole("region", { name: "Job notes" }).screenshot();
    },
    expected:
      "the note form (text box, audience menu, Add note button; §5.7) is added below the empty list, so the box is taller",
  },
  {
    file: "blank-05-job-files-download",
    title: "Job files",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return page.getByRole("region", { name: "Job files" }).screenshot();
    },
    expected:
      "downloads are available (§5.8): the 'Downloads aren't available in this view.' text is replaced by the DOWNLOAD ALL FILES (.ZIP) button",
  },
  {
    file: "blank-06-access-manager-dashboard-view",
    title: "Access manager",
    theme: "light",
    device: "desktop",
    capture: async (page) => {
      await page.goto("/");
      return page.getByRole("region", { name: "Access manager" }).screenshot();
    },
    expected:
      "the manager is live: an email, name, role and job form with a Grant access button replaces the read-only copy, and the intro text is the spec's wording (§3.4)",
  },
  {
    file: "blank-07-developer-notes",
    title: "Developer notes",
    theme: "light",
    device: "desktop",
    capture: null,
    expected:
      "not in the app by design: a temporary box for the developer that was to be removed before go-live (its content is captured as requirements in PRODUCT_SPEC §13)",
  },
  {
    file: "blank-08-approval-decline-form-validation",
    title: "Fee proposal, decline form with validation message",
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await expanded(page, jobId);
      const proposal = card(page, "i1_0p");
      await proposal.getByRole("button", { name: "Decline fee proposal" }).click();
      await proposal.getByRole("button", { name: /confirm decline/i }).click();
      return proposal.screenshot();
    },
    expected:
      "the card also shows the live drop zone in 'Fee proposal documents' (taller card); the Approve and Decline buttons show for the roles that may decide (§2.1)",
  },
  {
    file: "blank-11-dashboard",
    title: "Dashboard",
    theme: "light",
    device: "desktop",
    capture: async (page) => {
      await page.goto("/");
      await page.getByRole("article").first().waitFor();
      return whole(page);
    },
    expected: `${HEADER}; the New job button, the live Access manager form and ${UPLOAD_LIMIT}`,
  },
  {
    file: "blank-12-dark-tracker-collapsed",
    title: "Tracker, every stage collapsed (dark)",
    theme: "dark",
    device: "desktop",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return whole(page);
    },
    expected: `${HEADER}; ${UPLOAD_LIMIT}; the Developer notes box is gone (see blank-07)`,
  },
  {
    file: "blank-13-dark-stage-wapc-approval",
    title: "WAPC Approval stage (dark)",
    theme: "dark",
    device: "desktop",
    capture: async (page, jobId) => {
      await expanded(page, jobId);
      return stage(page, 1).screenshot();
    },
    expected:
      "live drop zones in every box (the stage is taller and everything below the first box is offset); the conditions panel and the Decision Letter drop zone wording follow PRODUCT_SPEC §5.5 where it says Change",
  },
  {
    file: "blank-14-dark-dashboard",
    title: "Dashboard (dark)",
    theme: "dark",
    device: "desktop",
    capture: async (page) => {
      await page.goto("/");
      await page.getByRole("article").first().waitFor();
      return whole(page);
    },
    expected: `${HEADER}; the New job button, the live Access manager form and ${UPLOAD_LIMIT}`,
  },
  {
    file: "blank-15-mobile-tracker-collapsed",
    title: "Tracker, every stage collapsed (390 px)",
    theme: "light",
    device: "mobile",
    capture: async (page, jobId) => {
      await collapsed(page, jobId);
      return whole(page);
    },
    expected: `${HEADER} (the header stacks on a phone); ${UPLOAD_LIMIT}; the Developer notes box is gone (see blank-07)`,
  },
  {
    file: "blank-16-mobile-stage-wapc-approval",
    title: "WAPC Approval stage (390 px)",
    theme: "light",
    device: "mobile",
    capture: async (page, jobId) => {
      await expanded(page, jobId);
      return stage(page, 1).screenshot();
    },
    expected:
      "live drop zones in every box (the stage is taller and everything below the first box is offset); the conditions panel and the Decision Letter drop zone wording follow PRODUCT_SPEC §5.5 where it says Change",
  },
  {
    file: "blank-17-mobile-dashboard",
    title: "Dashboard (390 px)",
    theme: "light",
    device: "mobile",
    capture: async (page) => {
      await page.goto("/");
      await page.getByRole("article").first().waitFor();
      return whole(page);
    },
    expected: `${HEADER}; the New job button, the live Access manager form and ${UPLOAD_LIMIT}`,
  },
  ...STAGES.map(([file, name], index): ParityView => ({
    file: `blank-${file}`,
    title: `${name} stage`,
    theme: "light",
    device: "desktop",
    capture: async (page, jobId) => {
      await expanded(page, jobId);
      return stage(page, index).screenshot();
    },
    expected:
      "live drop zones in every box ('Drag and drop … here', the accepted types, 'or click to choose') that the prototype's demo copy did not show, so the stage is taller and the cards below the first drop zone are offset; wording follows PRODUCT_SPEC §5 where it says Change",
  })),
];
