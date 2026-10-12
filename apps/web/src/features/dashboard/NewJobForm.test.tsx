import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { draftKey, queryKeys } from "@/lib/api";
import { MESSAGES } from "@/lib/messages";
import { navigation } from "@/lib/navigation";
import { syntheticMe } from "@/test/fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockOffline, mockProblem, mockRateLimited } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { BannerRegion } from "@/components/ui/BannerRegion";
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

  it("says to wait on a 429 and that the server can't be reached when the request never arrives", async () => {
    setTestUrl("/");
    server.use(mockRateLimited("createJob"));
    renderWithProviders(<NewJobForm onCancel={() => undefined} />);
    await fill({ number: "S-0001", address: "1 Test St", type: "Freehold" });
    await create();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many changes – wait a moment and try again. (Request ID: req-429)",
    );
    server.use(mockOffline("createJob"));
    await create();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.",
      );
    });
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

describe("NewJobForm when the session ends (PRODUCT_SPEC 3.1, 15)", () => {
  const me = syntheticMe("staff");
  const expireWhileFilled = async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    setTestUrl("/");
    server.use(mockProblem("createJob", 401, PROBLEM_TYPES.unauthenticated));
    const view = renderWithProviders(<NewJobForm onCancel={() => undefined} />, { me });
    await fill({ number: "S-0042", address: "5 Synthetic Way", client: "Example Client", type: "Freehold" });
    await create();
    await waitFor(() => {
      expect(assign).toHaveBeenCalledTimes(1);
    });
    view.unmount();
  };

  it("keeps the typed fields when a request is refused with 401", async () => {
    await expireWhileFilled();
    expect(JSON.parse(window.sessionStorage.getItem(draftKey(me.user.id, "new-job")) ?? "null")).toMatchObject({
      text: JSON.stringify({
        jobNumber: "S-0042",
        address: "5 Synthetic Way",
        clientName: "Example Client",
        subdivisionType: "Freehold",
      }),
    });
  });

  it("puts the fields back after sign-in and says so", async () => {
    await expireWhileFilled();
    renderWithProviders(
      <>
        <BannerRegion />
        <NewJobForm onCancel={() => undefined} />
      </>,
      { me },
    );
    expect(screen.getByRole("textbox", { name: "Job number" })).toHaveValue("S-0042");
    expect(screen.getByRole("textbox", { name: "Address" })).toHaveValue("5 Synthetic Way");
    expect(screen.getByRole("textbox", { name: "Client (optional)" })).toHaveValue("Example Client");
    expect(screen.getByRole("combobox", { name: "Subdivision type" })).toHaveValue("Freehold");
    expect(screen.getByText(MESSAGES.draftRestored)).toBeInTheDocument();
    expect(window.sessionStorage).toHaveLength(0);
  });

  it("keeps nothing for an empty form", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    setTestUrl("/");
    server.use(mockProblem("createJob", 401, PROBLEM_TYPES.unauthenticated));
    renderWithProviders(<NewJobForm onCancel={() => undefined} />, { me });
    const { persistDrafts } = await import("@/lib/api");
    persistDrafts();
    expect(assign).not.toHaveBeenCalled();
    expect(window.sessionStorage).toHaveLength(0);
  });
});
