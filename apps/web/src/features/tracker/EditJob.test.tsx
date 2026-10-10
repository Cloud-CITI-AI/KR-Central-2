import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
