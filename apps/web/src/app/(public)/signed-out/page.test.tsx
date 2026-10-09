import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import SignedOutPage from "./page";

describe("signed-out page", () => {
  it("says the person has signed out and links back to sign-in", async () => {
    const { container } = render(<SignedOutPage />);
    expect(screen.getByRole("heading", { level: 2, name: "You have signed out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    await expectNoAxeViolations(container);
  });
});
