import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticMe } from "@/test/fixtures";
import { mockApi } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderWithProviders } from "@/test/render";
import { Dashboard } from "./Dashboard";
import { setTestUrl } from "./test-router";

vi.mock("next/navigation", async () => (await import("./test-router")).navigationMock);
// The content chunk never arrives: what the page shows meanwhile is the fallback under test.
vi.mock("./DashboardContent", () => new Promise(() => undefined));

beforeEach(() => {
  setTestUrl("/");
  server.use(mockApi("getMe", syntheticMe()));
});

describe("Dashboard while its content chunk loads", () => {
  it("shows the skeleton that holds the content's place (CLS), not nothing", () => {
    renderWithProviders(<Dashboard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard…");
    expect(screen.queryByRole("heading", { name: "Subdivision dashboard" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeInTheDocument();
  });
});
