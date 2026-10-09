import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { ButtonLink } from "./ButtonLink";

describe("ButtonLink", () => {
  it("is a real link to its href, reachable by keyboard", async () => {
    const { container } = render(
      <ButtonLink href="/api/v1/auth/login" variant="primary">
        Sign in with Microsoft
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Sign in with Microsoft" });
    expect(link).toHaveAttribute("href", "/api/v1/auth/login");
    link.focus();
    expect(link).toHaveFocus();
    await expectNoAxeViolations(container);
  });

  it("links pages with client-side navigation but leaves /api targets to the browser", () => {
    render(
      <>
        <ButtonLink href="/sign-in">Try again</ButtonLink>
        <ButtonLink href="/api/v1/auth/login">Sign in</ButtonLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/api/v1/auth/login");
  });
});
