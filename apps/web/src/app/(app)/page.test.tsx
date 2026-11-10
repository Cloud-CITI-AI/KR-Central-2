import { configure, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { syntheticFacets, syntheticJobCard } from "@/features/dashboard/test-fixtures";
import { expectNoAxeViolations } from "@/test/axe";
import { syntheticMe } from "@/test/fixtures";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import HomePage, { metadata } from "./page";

const session = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock("@/lib/session/get-me", () => session);
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: nav.redirect,
}));

configure({ asyncUtilTimeout: 5000 });
beforeAll(() => {
  vi.setSystemTime(new Date("2026-11-09T14:00:00"));
});

describe("HomePage (KR Central)", () => {
  it("is titled Home", () => {
    expect(metadata.title).toBe("Home");
  });

  it("greets the person, states the finding, offers the modules they may open and lists what needs them", async () => {
    server.use(
      mockApi("getJobFacets", syntheticFacets()),
      mockApi("listJobs", {
        items: [
          syntheticJobCard({
            jobNumber: "S-0041",
            alerts: [{ code: "approval_expiring", level: "warn", text: "Decision letter expires in 11 days" }],
          }),
          syntheticJobCard({
            jobNumber: "S-0038",
            alerts: [{ code: "outcome_passed", level: "bad", text: "Outcome date passed" }],
          }),
          syntheticJobCard({ jobNumber: "S-0042" }),
        ],
        nextCursor: null,
      }),
    );
    const me = syntheticMe("admin");
    session.getMe.mockResolvedValue(me);
    const { container } = renderWithProviders(await HomePage(), { me });
    expect(await screen.findByRole("heading", { level: 1, name: /Good afternoon/ })).toBeInTheDocument();
    expect(await screen.findByText(/jobs? needs? attention/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Subdivision Tracker" })).toHaveAttribute("href", "/subdivisions");
    expect(screen.getByRole("link", { name: "Open Users" })).toHaveAttribute("href", "/admin/users");
    expect(screen.getByRole("link", { name: "Open Audit trail" })).toHaveAttribute("href", "/admin/audit");
    const needs = await screen.findByRole("heading", { name: "Needs you" });
    expect(needs).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    // the bad alert first, the warning second, the job without alerts not at all
    expect(items[0]).toHaveTextContent("S-0038");
    expect(items[1]).toHaveTextContent("S-0041");
    expect(items).toHaveLength(2);
    await expectNoAxeViolations(container);
  });

  it("sends a client or architect straight to their jobs: Home is for KR people", async () => {
    session.getMe.mockResolvedValue(syntheticMe("external"));
    await expect(HomePage()).rejects.toThrow("REDIRECT /subdivisions");
  });

  it("offers staff the tracker and nothing from admin", async () => {
    const me = syntheticMe("staff");
    session.getMe.mockResolvedValue(me);
    server.use(mockApi("getJobFacets", syntheticFacets()), mockApi("listJobs", { items: [], nextCursor: null }));
    renderWithProviders(await HomePage(), { me });
    expect(await screen.findByRole("link", { name: "Open Subdivision Tracker" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Users" })).toBeNull();
    expect(await screen.findByText("Nothing needs your attention right now.")).toBeInTheDocument();
  });
});
