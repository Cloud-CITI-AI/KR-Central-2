import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { syntheticJob } from "@/features/tracker/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { checkpointOf, renderCard, withCheckpoint } from "./test-utils";

const PAID_AT = "2026-09-28T03:50:56.543Z";
const paidState = { status: "completed", storedStatus: "completed", paid: { at: PAID_AT, by: null } } as const;

describe("paid panel", () => {
  it.each([
    ["i4_1", "Client response", "INVOICE PAID"],
    ["i6_2", "Client decision", "Invoice PAID"],
    ["i6_6", "Client response", "WORKS COMPLETE"],
    ["i6_7", "Client response", "WORKS COMPLETE"],
    ["i7_5", "Client response", "Invoice PAID"],
    ["i8_3", "Client response", "FEE PAID"],
    ["i9_2", "Client response", "QUOTE PAID"],
    ["i14_0", "Client response", "TITLES OBTAINED"],
  ])("%s shows the label “%s” and the button “%s” from the definition", async (key, label, button) => {
    const { container } = renderCard(syntheticJob(), key);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: button })).toBeEnabled();
    await expectNoAxeViolations(container);
  });

  it("records the response: the API's answer sets Completed and the box reads “Invoice paid 28 Sep 2026” with Undo", async () => {
    const job = syntheticJob();
    const { served } = renderCard(job, "i4_1");
    let calls = 0;
    server.use(
      handlerFor("markPaid", () => {
        calls += 1;
        served.job = withCheckpoint(job, "i4_1", paidState);
        return HttpResponse.json(checkpointOf(served.job, "i4_1"));
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "INVOICE PAID" }));
    expect(await screen.findByText("Invoice paid")).toBeInTheDocument();
    expect(screen.getByText("28 Sep 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "INVOICE PAID" })).not.toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it("undoes it: the API sets Not completed and the button comes back", async () => {
    const job = withCheckpoint(syntheticJob(), "i9_2", paidState);
    const { served } = renderCard(job, "i9_2");
    let calls = 0;
    server.use(
      handlerFor("undoPaid", () => {
        calls += 1;
        served.job = withCheckpoint(job, "i9_2", {
          status: "not_completed",
          storedStatus: "not_completed",
          paid: null,
        });
        return HttpResponse.json(checkpointOf(served.job, "i9_2"));
      }),
    );
    expect(screen.getByText("Quote paid")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "QUOTE PAID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not completed" })).toHaveAttribute("aria-pressed", "true");
    expect(calls).toBe(1);
  });

  it("lets a client press it but not an architect, and shows the done state without Undo to the architect", () => {
    const client = renderCard(syntheticJob({ role: "external", grantRole: "client" }), "i4_1");
    expect(screen.getByRole("button", { name: "INVOICE PAID" })).toBeEnabled();
    client.unmount();
    const architect = renderCard(syntheticJob({ role: "external", grantRole: "architect" }), "i4_1");
    expect(screen.getByRole("button", { name: "INVOICE PAID" })).toBeDisabled();
    architect.unmount();
    renderCard(withCheckpoint(syntheticJob({ role: "external", grantRole: "architect" }), "i4_1", paidState), "i4_1");
    expect(screen.getByText("Invoice paid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("shows the save-failed banner and keeps the button when recording fails", async () => {
    renderCard(syntheticJob(), "i4_1");
    server.use(mockProblem("markPaid", 500));
    await userEvent.click(screen.getByRole("button", { name: "INVOICE PAID" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "INVOICE PAID" })).toBeEnabled();
  });

  it("shows the save-failed banner and keeps the done state when Undo fails", async () => {
    renderCard(withCheckpoint(syntheticJob(), "i4_1", paidState), "i4_1");
    server.use(mockProblem("undoPaid", 500));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(/A change couldn't be saved/)).toBeInTheDocument();
    expect(screen.getByText("Invoice paid")).toBeInTheDocument();
  });
});
