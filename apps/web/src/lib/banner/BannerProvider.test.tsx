import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BannerProvider, useBanners } from "./BannerProvider";

const setup = () => renderHook(() => useBanners(), { wrapper: BannerProvider });

describe("BannerProvider", () => {
  it("shows, replaces by id and dismisses banners", () => {
    const { result } = setup();
    act(() => {
      result.current.show("a", "First");
      result.current.show("b", "Second");
      result.current.show("a", "First again");
    });
    expect(result.current.banners).toEqual([
      { id: "b", text: "Second" },
      { id: "a", text: "First again" },
    ]);
    act(() => {
      result.current.dismiss("b");
    });
    expect(result.current.banners).toEqual([{ id: "a", text: "First again" }]);
  });

  it("fails loudly outside the provider", () => {
    function Probe() {
      useBanners();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/BannerProvider/);
  });
});
