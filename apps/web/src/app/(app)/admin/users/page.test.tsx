import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { syntheticMe } from "@/test/fixtures";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);
vi.mock("@/features/admin/UsersPage", () => ({ UsersPage: () => <p>users page</p> }));
vi.mock("@/features/admin/AdminHeader", () => ({ AdminHeader: () => <h2>Users</h2> }));

import AdminUsersPage from "./page";

describe("/admin/users", () => {
  it("renders for an admin", async () => {
    session.getMe.mockResolvedValue(syntheticMe("admin"));
    render(await AdminUsersPage());
    expect(await screen.findByText("users page")).toBeInTheDocument();
  });

  it.each(["kr_admin", "staff", "external"] as const)("is the not-found page for %s", async (role) => {
    session.getMe.mockResolvedValue(syntheticMe(role));
    await expect(AdminUsersPage()).rejects.toMatchObject({ digest: expect.stringContaining("404") as unknown });
  });
});
