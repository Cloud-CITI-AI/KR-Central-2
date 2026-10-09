import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { JobDetailsDialog } from "./JobDetailsDialog";
import { syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";

function setup() {
  const job = syntheticJob({ fields: { jobNumber: "S-0001", address: "1 Example Rd", clientName: "Example Client" } });
  const onClose = vi.fn();
  const view = renderTracker(<JobDetailsDialog job={job} open onClose={onClose} />);
  view.queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
  return { job, onClose, ...view };
}

describe("JobDetailsDialog", () => {
  it("shows the job's fields, labelled, in a dialog called Job details", async () => {
    const { job, container } = setup();
    expect(screen.getByRole("dialog", { name: "Job details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Job number")).toHaveValue(job.jobNumber);
    expect(screen.getByLabelText("Address")).toHaveValue(job.address);
    expect(screen.getByLabelText("Client (optional)")).toHaveValue("Example Client");
    expect(screen.getByLabelText("Subdivision type")).toHaveValue("Survey-Strata");
    await expectNoAxeViolations(container);
  });

  it("saves only what changed with If-Match, then closes; an emptied client is cleared", async () => {
    const { job, onClose } = setup();
    const seen: { ifMatch: string | null; body: unknown }[] = [];
    server.use(
      handlerFor("updateJob", async ({ request }) => {
        seen.push({ ifMatch: request.headers.get("if-match"), body: await request.json() });
        return HttpResponse.json({ ...job, address: "2 Example Rd", clientName: null, version: 2 });
      }),
    );
    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.type(screen.getByLabelText("Address"), "2 Example Rd");
    await userEvent.clear(screen.getByLabelText("Client (optional)"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(seen).toEqual([{ ifMatch: '"1"', body: { address: "2 Example Rd", clientName: null } }]);
  });

  it("closes without a request when nothing changed", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("asks for a job number and an address before saving", async () => {
    setup();
    await userEvent.clear(screen.getByLabelText("Job number"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the job number.");
    await userEvent.type(screen.getByLabelText("Job number"), "S-0001");
    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the address.");
  });

  it("rejects a job number the contract does not allow without calling the API", async () => {
    setup();
    await userEvent.clear(screen.getByLabelText("Job number"));
    await userEvent.type(screen.getByLabelText("Job number"), "S_1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters, numbers, spaces");
  });

  it("says when the job number is already in use and stays open", async () => {
    const { onClose } = setup();
    server.use(mockProblem("updateJob", 409, PROBLEM_TYPES.conflict));
    await userEvent.clear(screen.getByLabelText("Job number"));
    await userEvent.type(screen.getByLabelText("Job number"), "S-0002");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("S-0002 is already in use.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("on 412 closes and shows the stale banner with the latest job loaded (§5.1)", async () => {
    const { job, onClose } = setup();
    server.use(
      mockProblem("updateJob", 412, PROBLEM_TYPES.preconditionFailed),
      mockApi("getJob", { ...job, version: 4 }),
    );
    await userEvent.type(screen.getByLabelText("Address"), " Unit 2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Someone else changed this — the latest version has been loaded."),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("can pick a subdivision type for a job that has none", async () => {
    const job = syntheticJob({ fields: { subdivisionType: null } });
    renderTracker(<JobDetailsDialog job={job} open onClose={() => undefined} />);
    expect(screen.getByLabelText("Subdivision type")).toHaveValue("");
    await userEvent.selectOptions(screen.getByLabelText("Subdivision type"), "Freehold");
    expect(screen.getByRole("option", { name: "Freehold" })).toHaveProperty("selected", true);
  });
});
