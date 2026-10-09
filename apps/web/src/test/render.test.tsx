import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSession } from "@/lib/session";
import { expectNoAxeViolations } from "./axe";
import { renderWithProviders } from "./render";

describe("test utilities", () => {
  it("renderWithProviders supplies a synthetic session", () => {
    function Who() {
      return <p>{useSession().user.role}</p>;
    }
    renderWithProviders(<Who />);
    expect(screen.getByText("staff")).toBeInTheDocument();
  });

  it("the axe helper passes accessible markup and fails an unlabelled control", async () => {
    const good = renderWithProviders(
      <main>
        <h1>Title</h1>
        <label>
          Name <input />
        </label>
      </main>,
    );
    await expectNoAxeViolations(good.container);
    good.unmount();
    const bad = renderWithProviders(<input />);
    await expect(expectNoAxeViolations(bad.container)).rejects.toThrow(/label/);
  });
});
