import type { JobDetail } from "@kr/contracts";
import type { Agency } from "@kr/workflow";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticFile, uploadResult } from "@/features/checkpoints/test-fixtures";
import { stubUploads } from "@/features/checkpoints/test-upload";
import { renderWithJob } from "@/features/checkpoints/test-utils";
import { useJob } from "@/features/tracker";
import { expectNoAxeViolations } from "@/test/axe";
import { AgencyConditions } from "./AgencyConditions";
import { ConditionsPanel } from "./ConditionsPanel";
import { serveUpdates, threeConditions } from "./test-utils";
import { conditionAt, syntheticConditionJob, withCondition } from "./test-fixtures";

vi.mock("@/features/viewer", () => ({ useViewer: () => ({ open: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

interface PageProps {
  readonly jobId: string;
  readonly agencies: readonly Agency[];
}

/** What the tracker shows: the 5.0 checklist and the agency boxes, all reading the one job query. */
function Page({ jobId, agencies }: PageProps) {
  const { data: job } = useJob(jobId);
  const checkpoint = job?.checkpoints.find((c) => c.key === "i5_0");
  return job && checkpoint ? (
    <>
      <ConditionsPanel job={job} checkpoint={checkpoint} />
      {agencies.map((agency) => (
        <AgencyConditions key={agency} job={job} agency={agency} />
      ))}
    </>
  ) : null;
}

const renderPage = (job: JobDetail, agencies: readonly Agency[] = ["Western Power", "Water Corporation", "WAPC"]) =>
  renderWithJob(<Page jobId={job.id} agencies={agencies} />, job);

const box = (agency: string) => screen.getByRole("group", { name: `WAPC conditions – ${agency}` });
const checklist = (number: number) => screen.getByRole("group", { name: `Condition ${number}` });
const inBox = (number: number, agency: string) =>
  within(box(agency)).getByRole("group", { name: `Condition ${number} – ${agency}` });

describe("AgencyConditions", () => {
  it("renders nothing for an agency without conditions", () => {
    renderPage(syntheticConditionJob({ agencies: ["WAPC"] }), ["Western Power", "WAPC"]);
    expect(screen.queryByRole("group", { name: "WAPC conditions – Western Power" })).not.toBeInTheDocument();
    expect(box("WAPC")).toBeInTheDocument();
  });

  it("lists that agency's conditions first with the cleared count and a link back to the checklist", async () => {
    const job = threeConditions();
    const { container } = renderPage(job);
    const westernPower = within(box("Western Power"));
    expect(westernPower.getByText("WAPC conditions – Western Power")).toBeInTheDocument();
    expect(westernPower.getByText("0 of 1 cleared")).toBeInTheDocument();
    expect(westernPower.getByRole("link", { name: "Checklist ↑" })).toHaveAttribute("href", "#wapc-approval");
    expect(westernPower.getByText(conditionAt(job, 0).text)).toBeInTheDocument();
    expect(westernPower.queryByText(conditionAt(job, 1).text)).not.toBeInTheDocument();
    expect(within(box("Water Corporation")).getByText("1 of 1 cleared")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows the agency as a plain badge with the guessed marker, and no select, link or confirm button", () => {
    renderPage(threeConditions());
    const card = inBox(3, "WAPC");
    expect(within(card).getByText("WAPC")).toBeInTheDocument();
    expect(within(card).getByText("Agency guessed – please check")).toBeInTheDocument();
    expect(within(card).queryByRole("combobox", { name: "Agency for condition 3" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Agency is correct" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /Go to/ })).not.toBeInTheDocument();
  });

  it("shows a tick made in the checklist in the box, and one made in the box in the checklist", async () => {
    const job = threeConditions();
    const { served } = renderPage(job);
    serveUpdates(served);
    await userEvent.click(within(checklist(1)).getByRole("checkbox", { name: "Condition 1: Open" }));
    expect(
      await within(inBox(1, "Western Power")).findByRole("checkbox", { name: "Condition 1: Cleared" }),
    ).toBeChecked();
    expect(within(box("Western Power")).getByText("1 of 1 cleared")).toBeInTheDocument();
    await userEvent.click(
      within(inBox(2, "Water Corporation")).getByRole("checkbox", { name: "Condition 2: Cleared" }),
    );
    expect(await within(checklist(2)).findByRole("checkbox", { name: "Condition 2: Open" })).not.toBeChecked();
    expect(screen.getByText("Conditions checklist").closest("summary")).toHaveTextContent("1 of 3 cleared");
  });

  it("shows a comment typed in one place in the other once it is saved", async () => {
    const job = threeConditions();
    const { served } = renderPage(job);
    serveUpdates(served);
    await userEvent.type(
      within(inBox(1, "Western Power")).getByRole("textbox", { name: "Client comment – condition 1" }),
      "Sent",
    );
    await userEvent.tab();
    await waitFor(() => {
      expect(within(checklist(1)).getByRole("textbox", { name: "Client comment – condition 1" })).toHaveValue("Sent");
    });
  });

  it("moves a condition to the box of its new agency when the checklist changes it", async () => {
    const job = threeConditions();
    const { served } = renderPage(job);
    serveUpdates(served);
    await userEvent.selectOptions(
      within(checklist(1)).getByRole("combobox", { name: "Agency for condition 1" }),
      "Water Corporation",
    );
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: "WAPC conditions – Western Power" })).not.toBeInTheDocument();
    });
    expect(within(box("Water Corporation")).getByText("1 of 2 cleared")).toBeInTheDocument();
    expect(inBox(1, "Water Corporation")).toBeInTheDocument();
  });

  it("uploads evidence from the box and shows it in the checklist too", async () => {
    const job = threeConditions();
    const target = conditionAt(job, 0);
    const requests = stubUploads();
    const { served } = renderPage(job);
    await userEvent.upload(
      within(inBox(1, "Western Power")).getByLabelText(/Drop clearance evidence here/),
      new File([new Uint8Array(4)], "Approval.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const stored = syntheticFile(job.id, { name: "Approval.pdf", conditionId: target.id });
    served.job = withCondition(job, target.id, { evidence: [stored] });
    requests[0]?.finish(201, uploadResult(stored));
    expect(await within(inBox(1, "Western Power")).findByRole("button", { name: "Approval.pdf" })).toBeInTheDocument();
    expect(within(checklist(1)).getByRole("button", { name: "Approval.pdf" })).toBeInTheDocument();
  });

  it("gives a client the same box with only the client comment and evidence to change", async () => {
    const { container } = renderPage(threeConditions({ role: "external", grantRole: "client" }));
    const card = inBox(1, "Western Power");
    expect(within(card).getByRole("checkbox")).toBeDisabled();
    expect(within(card).getByRole("textbox", { name: "KR Surveys comment – condition 1" })).toHaveAttribute("readonly");
    expect(within(card).getByRole("textbox", { name: "Client comment – condition 1" })).not.toHaveAttribute("readonly");
    expect(within(card).getByLabelText(/Drop clearance evidence here/)).toBeEnabled();
    await expectNoAxeViolations(container);
  });
});
