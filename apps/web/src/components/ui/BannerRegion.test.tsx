import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useBanners } from "@/lib/banner/BannerProvider";
import { renderWithProviders } from "@/test/render";
import { BannerRegion } from "./BannerRegion";

function Trigger() {
  const { show } = useBanners();
  return (
    <button
      onClick={() => {
        show("x", "A change couldn't be saved.");
      }}
    >
      Fail
    </button>
  );
}

describe("BannerRegion", () => {
  it("is a polite live region that is mounted before banners arrive, and banners can be dismissed", async () => {
    const { container } = renderWithProviders(
      <>
        <BannerRegion />
        <Trigger />
      </>,
    );
    const region = container.querySelector("[aria-live='polite']");
    expect(region).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(region).toHaveTextContent("A change couldn't be saved.");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(region).toBeEmptyDOMElement();
  });
});
