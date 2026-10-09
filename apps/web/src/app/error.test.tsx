import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import ErrorPage from "./error";

describe("error page", () => {
  it("shows the digest as the request id and retries", async () => {
    const reset = vi.fn();
    const { container } = render(
      <ErrorPage error={Object.assign(new Error("boom"), { digest: "dg-123" })} reset={reset} />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("Request ID: dg-123")).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    await expectNoAxeViolations(container);
  });

  it("prefers the API request id of a problem", () => {
    render(
      <ErrorPage
        error={Object.assign(new Error("x"), { requestId: "req-api-1", digest: "dg" })}
        reset={() => undefined}
      />,
    );
    expect(screen.getByText("Request ID: req-api-1")).toBeInTheDocument();
  });
});
