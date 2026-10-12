import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { draftKey, persistDrafts, queryKeys } from "@/lib/api";
import { MESSAGES } from "@/lib/messages";
import { navigation } from "@/lib/navigation";
import { syntheticMe } from "@/test/fixtures";
import { mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { EditJob } from "./EditJob";
import { syntheticJob } from "./test-fixtures";
import { renderTracker } from "./test-utils";

vi.mock("next/navigation", async () => (await import("./test-utils")).navigationMock);

describe("EditJob", () => {
  it("offers Archive job… only with job.delete (admin and KR admin, not staff)", async () => {
    const staff = renderTracker(<EditJob job={syntheticJob({ role: "staff" })} />);
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    // The dialog is loaded on demand, so wait for it before looking for what it does not offer.
    expect(await screen.findByRole("dialog", { name: "Job details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive job…" })).toBeNull();
    staff.unmount();
    renderTracker(<EditJob job={syntheticJob({ role: "kr_admin" })} />);
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    expect(await screen.findByRole("button", { name: "Archive job…" })).toBeInTheDocument();
  });

  it("opens the archive confirmation from the link and returns to the details on Cancel", async () => {
    renderTracker(<EditJob job={syntheticJob({ role: "admin", fields: { jobNumber: "S-0001" } })} />);
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    await userEvent.click(await screen.findByRole("button", { name: "Archive job…" }));
    const confirm = screen.getByRole("dialog", { name: "Archive job" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Archive job" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Job details" })).toBeInTheDocument();
  });
});

describe("EditJob when the session ends (PRODUCT_SPEC 3.1, 15)", () => {
  const me = syntheticMe("staff");
  const saveWithExpiredSession = async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    const job = syntheticJob({ role: "staff", fields: { jobNumber: "S-0001", address: "1 Example Rd" } });
    const view = renderTracker(<EditJob job={job} />, { me });
    view.queryClient.setQueryData(queryKeys.jobs.detail(job.id), job);
    server.use(mockProblem("updateJob", 401, PROBLEM_TYPES.unauthenticated));
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    const address = await screen.findByLabelText("Address");
    await userEvent.clear(address);
    await userEvent.type(address, "2 Example Rd");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    return job;
  };

  it("keeps the edited fields when Save is refused with 401", async () => {
    const job = await saveWithExpiredSession();
    expect(JSON.parse(window.sessionStorage.getItem(draftKey(me.user.id, job.id, "details")) ?? "null")).toMatchObject({
      text: expect.stringContaining("2 Example Rd") as string,
    });
  });

  it("reopens EDIT JOB with the edited values after sign-in, and says they were restored", async () => {
    const job = await saveWithExpiredSession();
    renderTracker(<EditJob job={job} />, { me });
    const dialog = await screen.findByRole("dialog", { name: "Job details" });
    expect(within(dialog).getByLabelText("Address")).toHaveValue("2 Example Rd");
    expect(within(dialog).getByLabelText("Job number")).toHaveValue("S-0001");
    expect(screen.getByText(MESSAGES.draftRestored)).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("keeps nothing for a dialog that was opened and left as the job has it, or cancelled", async () => {
    window.sessionStorage.clear();
    const job = syntheticJob({ role: "staff", fields: { jobNumber: "S-0001", address: "1 Example Rd" } });
    renderTracker(<EditJob job={job} />, { me });
    await userEvent.click(screen.getByRole("button", { name: "EDIT JOB" }));
    await userEvent.type(await screen.findByLabelText("Address"), "x");
    await userEvent.clear(screen.getByLabelText("Address"));
    await userEvent.type(screen.getByLabelText("Address"), "1 Example Rd");
    persistDrafts(); // what a 401 does before it leaves for sign-in
    expect(window.sessionStorage).toHaveLength(0);
    await userEvent.type(screen.getByLabelText("Address"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    persistDrafts();
    expect(window.sessionStorage).toHaveLength(0);
  });
});
