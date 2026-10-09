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

  it("has no links for a KR admin, who can open only the audit trail", () => {
    renderWithProviders(<AdminHeader current="audit" />, { me: syntheticMe("kr_admin") });
    expect(screen.getByRole("heading", { level: 2, name: "Audit trail" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
