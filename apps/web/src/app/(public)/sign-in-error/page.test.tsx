import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SIGN_IN_ERRORS } from "@/lib/auth-errors";
import { expectNoAxeViolations } from "@/test/axe";
import SignInErrorPage from "./page";

const show = async (reason?: string | string[]) =>
  render(await SignInErrorPage({ searchParams: Promise.resolve(reason === undefined ? {} : { reason }) }));

describe("sign-in-error page", () => {
  it.each(Object.entries(SIGN_IN_ERRORS))(
    "shows the §3.1 text for reason=%s and a Try again link",
    async (reason, text) => {
      const { container } = await show(reason);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/sign-in");
      await expectNoAxeViolations(container);
    },
  );

  it("falls back to the generic text for a missing, unknown or repeated reason", async () => {
    for (const reason of [undefined, "made_up", ["a", "b"]]) {
      const { unmount } = await show(reason);
      expect(screen.getByText("Sign-in didn't work – please try again.")).toBeInTheDocument();
      unmount();
    }
  });
});
