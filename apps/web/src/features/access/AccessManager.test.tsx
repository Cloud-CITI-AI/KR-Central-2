import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { syntheticMe } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AccessManager } from "./AccessManager";

const description =
  "Add the people who should be able to view a job – choose the job from the list. KR Surveys staff see all jobs automatically.";

describe("AccessManager", () => {
  it("shows staff the box and tells them KR IT must invite the guest in Entra (flag off)", () => {
    renderWithProviders(<AccessManager />);
    expect(screen.getByRole("region", { name: "Access manager" })).toBeInTheDocument();
    expect(
      screen.getByText(
        `${description} KR Surveys IT must also invite them as a guest in Microsoft Entra before they can sign in.`,
      ),
    ).toBeInTheDocument();
  });

  it("says the invitation is sent automatically when the flag is on", () => {
    const me = syntheticMe("kr_admin", {
      features: { aiStampReading: false, guestInvites: true, malwareScanning: true },
    });
    renderWithProviders(<AccessManager />, { me });
    expect(
      screen.getByText(`${description} They are sent a Microsoft Entra invitation email automatically.`),
    ).toBeInTheDocument();
  });

  it("is not shown to an external user", () => {
    const { container } = renderWithProviders(<AccessManager />, { me: syntheticMe("external") });
    expect(container).toBeEmptyDOMElement();
  });
});
