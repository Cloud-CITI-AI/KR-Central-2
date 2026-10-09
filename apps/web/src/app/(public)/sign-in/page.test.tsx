import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import SignInPage from "./page";

const show = async (returnTo?: string | string[]) =>
  render(await SignInPage({ searchParams: Promise.resolve(returnTo === undefined ? {} : { returnTo }) }));
const login = () => screen.getByRole("link", { name: "Sign in with Microsoft" });

describe("sign-in page", () => {
  it("offers Sign in with Microsoft to the API login and a short privacy note", async () => {
    const { container } = await show();
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
    expect(login()).toHaveAttribute("href", "/api/v1/auth/login");
    expect(screen.getByText(/Your Microsoft password is never shared/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("keeps a same-origin returnTo", async () => {
    await show("/jobs/abc?stage=wapc");
    expect(login()).toHaveAttribute("href", "/api/v1/auth/login?returnTo=%2Fjobs%2Fabc%3Fstage%3Dwapc");
  });

  it.each(["//evil.example.com", "https://evil.example.com/x", "javascript:alert(1)", ["/a", "/b"]])(
    "drops an unsafe returnTo (%j)",
    async (value) => {
      await show(value);
      expect(login()).toHaveAttribute("href", "/api/v1/auth/login");
    },
  );
});
