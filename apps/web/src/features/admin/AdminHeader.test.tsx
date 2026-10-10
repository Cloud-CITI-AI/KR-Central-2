import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AdminHeader } from "./AdminHeader";

describe("AdminHeader", () => {
  it("links an admin to both pages and marks the current one", async () => {
    const { container } = renderWithProviders(<AdminHeader current="audit" />, { me: syntheticMe("admin") });
    expect(screen.getByRole("heading", { level: 2, name: "Audit trail" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit trail" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: "Users" })).not.toHaveAttribute("aria-current");
    await expectNoAxeViolations(container);
  });

  it("has a Dashboard link back, like the tracker's jobbar, for every admin role", () => {
    for (const role of ["admin", "kr_admin"] as const) {
      const { unmount } = renderWithProviders(<AdminHeader current="audit" />, { me: syntheticMe(role) });
      expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
      unmount();
    }
  });

  it("styles both tabs the same way (the same class, current or not)", () => {
    renderWithProviders(<AdminHeader current="users" />, { me: syntheticMe("admin") });
    const [users, audit] = [
      screen.getByRole("link", { name: "Users" }),
      screen.getByRole("link", { name: "Audit trail" }),
    ];
    expect(users.className).toBe(audit.className);
    expect(users.className).toContain("tab");
  });

  it("has no links for a KR admin, who can open only the audit trail", () => {
    renderWithProviders(<AdminHeader current="audit" />, { me: syntheticMe("kr_admin") });
    expect(screen.getByRole("heading", { level: 2, name: "Audit trail" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
