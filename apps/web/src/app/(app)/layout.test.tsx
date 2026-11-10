import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);
vi.mock("next/navigation", () => ({ usePathname: () => "/subdivisions" }));

import AppLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("(app) layout", () => {
  it("wraps the page in the KR Central shell: sidebar with the person and their pages, breadcrumbs, banners, main, the one-line footer", async () => {
    const me = syntheticMe("kr_admin");
    session.getMe.mockResolvedValue(me);
    const { container } = render(await AppLayout({ children: <p>Dashboard goes here</p> }));
    const side = screen.getByRole("complementary", { name: "KR Central" });
    expect(side).toHaveTextContent(me.user.displayName);
    expect(side).toHaveTextContent("KR Admin");
    expect(within(side).getByRole("link", { name: "Audit trail" })).toHaveAttribute("href", "/admin/audit");
    expect(within(side).queryByRole("link", { name: "Users" })).toBeNull();
    expect(within(side).getByRole("link", { name: "Subdivision Tracker" })).toHaveAttribute("href", "/subdivisions");
    expect(within(side).getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/subdivisions");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent(
      "Home/Subdivision Tracker/Dashboard",
    );
    expect(screen.getByRole("main")).toHaveTextContent("Dashboard goes here");
    expect(container.querySelector("[aria-live='polite']")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("up to 50 MB each");
    expect(screen.queryByRole("link", { name: "Send feedback" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse the sidebar" })).toHaveAttribute("aria-expanded", "true");
    await expectNoAxeViolations(container);
  });

  it("adds the feedback link when FEEDBACK_URL is set", async () => {
    vi.stubEnv("FEEDBACK_URL", "https://forms.example.com/kr");
    session.getMe.mockResolvedValue(syntheticMe("staff"));
    render(await AppLayout({ children: <p>x</p> }));
    expect(screen.getByRole("link", { name: "Send feedback" })).toHaveAttribute("href", "https://forms.example.com/kr");
  });

  it("does not render anything when there is no session (getMe redirects or throws)", async () => {
    session.getMe.mockRejectedValue(new Error("REDIRECT /sign-in"));
    await expect(AppLayout({ children: <p>secret</p> })).rejects.toThrow("REDIRECT");
  });
});
