import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/api";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { NewJobForm } from "./NewJobForm";
import { pushed, setTestUrl } from "./test-router";
import { syntheticJobDetail } from "./test-fixtures";

vi.mock("next/navigation", async () => (await import("./test-router")).navigationMock);

async function fill(values: { number?: string; address?: string; client?: string; type?: string }) {
  if (values.number) await userEvent.type(screen.getByRole("textbox", { name: "Job number" }), values.number);
  if (values.address) await userEvent.type(screen.getByRole("textbox", { name: "Address" }), values.address);
  if (values.client) await userEvent.type(screen.getByRole("textbox", { name: "Client (optional)" }), values.client);
  if (values.type)
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Subdivision type" }), values.type);
}
const create = () => userEvent.click(screen.getByRole("button", { name: "Create job" }));

describe("NewJobForm", () => {
  it("starts with the job number focused and the six subdivision types to choose from", async () => {
    setTestUrl("/");
    const { container } = renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    expect(screen.getByRole("textbox", { name: "Job number" })).toHaveFocus();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Subdivision type…",
      "Survey-Strata",
      "Built Strata",
      "Amalgamation",
      "Freehold",
      "Strata Conversion",
      "Re-Subdivision",
    ]);
    await expectNoAxeViolations(container);
  });

  it("asks for the missing fields one at a time and sends nothing", async () => {
    setTestUrl("/");
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the job number.");
    await fill({ number: "S-0001" });
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the address.");
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveFocus();
    await fill({ address: "1 Test St" });
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose the subdivision type.");
    expect(pushed).toEqual([]);
  });

  it("rejects a job number with characters the contract does not allow", async () => {
    setTestUrl("/");
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: "S#1", address: "1 Test St", type: "Freehold" });
    await create();
    expect(screen.getByRole("alert")).toHaveTextContent("Use letters, numbers, spaces, '-', '.' or '/'");
  });

  it("creates the job with an idempotency key and opens its tracker", async () => {
    setTestUrl("/");
    const job = syntheticJobDetail();
    const seen: { body: unknown; key: string | null }[] = [];
    server.use(
      handlerFor("createJob", async ({ request }) => {
        seen.push({ body: await request.json(), key: request.headers.get("idempotency-key") });
        return HttpResponse.json(job, { status: 201 });
      }),
    );
    const { queryClient } = renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: " S-0001 ", address: "1 Test St", client: "Acme", type: "Freehold" });
    await create();
    await waitFor(() => {
      expect(pushed).toEqual([`/jobs/${job.id}`]);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.body).toEqual({
      jobNumber: "S-0001",
      address: "1 Test St",
      clientName: "Acme",
      subdivisionType: "Freehold",
    });
    expect(seen[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(queryClient.getQueryData(queryKeys.jobs.detail(job.id))).toEqual(job);
  });

  it("leaves the client out when it is empty", async () => {
    setTestUrl("/");
    let body: unknown;
    server.use(
      handlerFor("createJob", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(syntheticJobDetail(), { status: 201 });
      }),
    );
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: "S-0002", address: "2 Test St", type: "Amalgamation" });
    await create();
    await waitFor(() => {
      expect(pushed).toHaveLength(1);
    });
    expect(body).toEqual({ jobNumber: "S-0002", address: "2 Test St", subdivisionType: "Amalgamation" });
  });

  it("says the number is already in use on a 409 and keeps the form", async () => {
    setTestUrl("/");
    server.use(mockProblem("createJob", 409, PROBLEM_TYPES.conflict));
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: "S-0001", address: "1 Test St", type: "Freehold" });
    await create();
    expect(await screen.findByRole("alert")).toHaveTextContent("S-0001 is already in use.");
    expect(screen.getByRole("textbox", { name: "Job number" })).toHaveFocus();
    expect(pushed).toEqual([]);
  });

  it("explains any other failure with the request id", async () => {
    setTestUrl("/");
    server.use(mockProblem("createJob", 500, PROBLEM_TYPES.internal, { requestId: "req-new-1" }));
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: "S-0001", address: "1 Test St", type: "Freehold" });
    await create();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That couldn't be saved. Try again. (Request ID: req-new-1)",
    );
  });

  it("closes with Cancel", async () => {
    setTestUrl("/");
    let cancelled = 0;
    renderWithProviders(
      <NewJobForm
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled).toBe(1);
  });
});
