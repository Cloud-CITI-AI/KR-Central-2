import { PROBLEM_TYPES, Problem } from "@kr/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ApiProblem } from "@/lib/api";
import { BannerRegion } from "@/components/ui/BannerRegion";
import { navigation } from "@/lib/navigation";
import { expectNoAxeViolations } from "@/test/axe";
import { handlerFor, mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { describeProblem, LAST_ADMIN, MFA_REQUIRED, ProblemNotice } from "./ProblemNotice";

function problem(status: number, detail?: string): ApiProblem {
  return new ApiProblem(
    Problem.parse({
      type: PROBLEM_TYPES.internal,
      title: "x",
      status,
      requestId: "req-1",
      ...(detail ? { detail } : {}),
    }),
  );
}

describe("describeProblem", () => {
  it("tells the four admin problems apart", () => {
    expect(describeProblem(problem(403, MFA_REQUIRED)).kind).toBe("mfa");
    expect(describeProblem(problem(409, LAST_ADMIN))).toMatchObject({ kind: "last-admin", text: LAST_ADMIN });
    expect(describeProblem(problem(409)).text).toBe(LAST_ADMIN);
    expect(describeProblem(problem(412)).kind).toBe("stale");
    expect(describeProblem(problem(403, "Forbidden"))).toMatchObject({ kind: "other", title: "You don't have access" });
    expect(describeProblem(problem(500))).toMatchObject({ kind: "other", requestId: "req-1" });
    expect(describeProblem(new Error("boom"))).toMatchObject({ kind: "other", requestId: undefined });
  });
});

describe("ProblemNotice", () => {
  it("shows the last-admin 409 text and the request id", async () => {
    const { container } = renderWithProviders(<ProblemNotice error={problem(409, LAST_ADMIN)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(LAST_ADMIN);
    expect(screen.getByText("Request ID: req-1")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows the 412 text from the spec", () => {
    renderWithProviders(<ProblemNotice error={problem(412)} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Someone else changed this — the latest version has been loaded.",
    );
  });

  it("offers Try again for other problems, and only when a retry is given", async () => {
    const onRetry = vi.fn();
    const { unmount } = renderWithProviders(<ProblemNotice error={problem(500)} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    unmount();
    renderWithProviders(<ProblemNotice error={problem(500)} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers sign out and in again for the MFA 403, which signs out and goes to Entra", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockApi("logout", { redirectTo: "https://login.example.com/logout" }));
    const { container } = renderWithProviders(<ProblemNotice error={problem(403, MFA_REQUIRED)} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(MFA_REQUIRED);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "Sign out and sign in again" }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://login.example.com/logout");
    });
  });

  it("says so in a banner when signing out fails, and lets the person try again", async () => {
    server.use(handlerFor("logout", () => HttpResponse.json({}, { status: 500 })));
    renderWithProviders(
      <>
        <BannerRegion />
        <ProblemNotice error={problem(403, MFA_REQUIRED)} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign out and sign in again" }));
    expect(await screen.findByText(/Sign-out didn't work/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out and sign in again" })).toBeEnabled();
  });
});
