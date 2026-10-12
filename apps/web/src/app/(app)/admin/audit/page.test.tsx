import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { syntheticMe } from "@/test/fixtures";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);
vi.mock("@/features/admin/AuditPage", () => ({ AuditPage: () => <p>audit page</p> }));
vi.mock("@/features/admin/AdminHeader", () => ({ AdminHeader: () => <h2>Audit trail</h2> }));

import AdminAuditPage from "./page";

describe("/admin/audit", () => {
  it.each(["admin", "kr_admin"] as const)("renders for %s", async (role) => {
    session.getMe.mockResolvedValue(syntheticMe(role));
    render(await AdminAuditPage());
    expect(await screen.findByText("audit page")).toBeInTheDocument();
  });

  it.each(["staff", "external"] as const)("is the not-found page for %s", async (role) => {
    session.getMe.mockResolvedValue(syntheticMe(role));
    await expect(AdminAuditPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") as unknown });
  });
});
