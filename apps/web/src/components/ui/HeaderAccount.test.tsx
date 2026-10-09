import { PROBLEM_TYPES } from "@kr/contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { mockApi, mockProblem } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { AppHeader } from "./AppHeader";
import { BannerRegion } from "./BannerRegion";
import { HeaderAccount } from "./HeaderAccount";

const header = (
  <>
    <AppHeader controls={<HeaderAccount />} />
    <BannerRegion />
  </>
);

describe("HeaderAccount in the hero header", () => {
  it("shows the user's name, the theme control and Sign out", async () => {
    const me = syntheticMe("staff");
    const { container } = renderWithProviders(header, { me });
    expect(screen.getByText(me.user.displayName)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it.each([
    ["admin", "/admin/users"],
    ["kr_admin", "/admin/audit"],
  ] as const)("links %s to %s", (role, href) => {
    renderWithProviders(header, { me: syntheticMe(role) });
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", href);
  });

  it.each(["staff", "external"] as const)("hides the Admin link from %s", (role) => {
    renderWithProviders(header, { me: syntheticMe(role) });
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("signs out with POST logout, then navigates to the returned end-session URL", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockApi("logout", { redirectTo: "https://login.microsoftonline.com/x/oauth2/v2.0/logout" }));
    renderWithProviders(header);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://login.microsoftonline.com/x/oauth2/v2.0/logout");
    });
  });

  it("keeps the user signed in and explains when sign-out fails", async () => {
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => undefined);
    server.use(mockProblem("logout", 500, PROBLEM_TYPES.internal, { requestId: "req-out-1" }));
    renderWithProviders(header);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByText("Sign-out didn't work – please try again. (Request ID: req-out-1)"),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
