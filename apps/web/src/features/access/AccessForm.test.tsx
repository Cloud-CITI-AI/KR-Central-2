import { PROBLEM_TYPES } from "@kr/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { syntheticJobCard } from "@/features/dashboard/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { handlerFor, mockApi, mockOffline, mockProblem, mockRateLimited } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { AccessForm } from "./AccessForm";
import { syntheticGrant } from "./test-fixtures";

const open = syntheticJobCard({ jobNumber: "S-0001", address: "1 Test St", clientName: "Acme", isComplete: false });
const done = syntheticJobCard({ jobNumber: "S-0002", address: "2 Test St", clientName: null, isComplete: true });
const jobs = () => mockApi("listJobs", { items: [open, done], nextCursor: null });

async function ready() {
  await screen.findByRole("option", { name: /S-0001/ });
}
const email = () => screen.getByRole("textbox", { name: "Email address" });
const grant = () => userEvent.click(screen.getByRole("button", { name: "Grant access" }));

describe("AccessForm", () => {
  it("offers the roles and every job grouped In progress / Complete", async () => {
    server.use(jobs());
    const { container } = renderWithProviders(<AccessForm />);
    await ready();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Client – sees their own job",
      "Architect – sees their own job",
      "Choose a job…",
      "S-0001 – 1 Test St – Acme (Survey-Strata)",
      "S-0002 – 2 Test St (Survey-Strata)",
    ]);
    const picker = screen.getByRole("combobox", { name: "Job" });
    expect(within(picker).getByRole("group", { name: "In progress" })).toBeInTheDocument();
    expect(within(picker).getByRole("group", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByText("Clients and architects only see the job you choose.")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("rejects an invalid email with the spec's message and focuses it", async () => {
    server.use(jobs());
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), "not-an-email");
    await grant();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address, e.g. name@example.com.");
    expect(email()).toHaveFocus();
  });

  it("asks for a job when none is chosen", async () => {
    server.use(jobs());
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), "a@example.com");
    await grant();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose which job they should see.");
    expect(screen.getByRole("combobox", { name: "Job" })).toHaveFocus();
  });

  it("grants access, says so, and clears the person but keeps the role and job", async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      jobs(),
      handlerFor("createAccessGrant", async ({ request }) => {
        body = await request.json();
        key = request.headers.get("idempotency-key");
        return HttpResponse.json(syntheticGrant({ email: "a@example.com" }), { status: 201 });
      }),
    );
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), " A@Example.com ");
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Alex Architect");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Role" }), "architect");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Job" }), open.id);
    await grant();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "a@example.com added – they get access when they sign in with that email.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("invitation");
    expect(body).toEqual({ email: "a@example.com", displayName: "Alex Architect", role: "architect", jobId: open.id });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(email()).toHaveValue("");
    expect(email()).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Job" })).toHaveValue(open.id);
  });

  it("adds the invitation sentence when guest invitations are on and one was sent", async () => {
    server.use(
      jobs(),
      handlerFor("createAccessGrant", () =>
        HttpResponse.json(syntheticGrant({ email: "a@example.com", invitationStatus: "sent" }), { status: 201 }),
      ),
    );
    const me = syntheticMe("staff", { features: { aiStampReading: false, guestInvites: true, malwareScanning: true } });
    renderWithProviders(<AccessForm />, { me });
    await ready();
    await userEvent.type(email(), "a@example.com");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Job" }), open.id);
    await grant();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "a@example.com added – they get access when they sign in with that email. An invitation email has been sent.",
    );
  });

  it("names the job when the person is already on its list (409)", async () => {
    server.use(jobs(), mockProblem("createAccessGrant", 409, PROBLEM_TYPES.conflict));
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), "a@example.com");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Job" }), open.id);
    await grant();
    expect(await screen.findByRole("alert")).toHaveTextContent("a@example.com is already on the list for S-0001.");
    expect(email()).toHaveValue("a@example.com");
  });

  it("explains any other failure with the request id", async () => {
    server.use(jobs(), mockProblem("createAccessGrant", 500, PROBLEM_TYPES.internal, { requestId: "req-acc-1" }));
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), "a@example.com");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Job" }), open.id);
    await grant();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That couldn't be saved. Try again. (Request ID: req-acc-1)",
    );
  });

  it("says to wait on a 429 and that the server can't be reached when the request never arrives", async () => {
    server.use(jobs(), mockRateLimited("createAccessGrant"));
    renderWithProviders(<AccessForm />);
    await ready();
    await userEvent.type(email(), "a@example.com");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Job" }), open.id);
    await grant();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many changes – wait a moment and try again. (Request ID: req-429)",
    );
    server.use(mockOffline("createAccessGrant"));
    await grant();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Can't reach the server – check your connection. What you see may be out of date, and changes can't be saved.",
      );
    });
  });
});
