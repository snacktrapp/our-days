import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationMapVisual } from "./location-map-visual";

describe("LocationMapVisual", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the illustration when coordinates or a key are missing", () => {
    render(<LocationMapVisual place="The porch" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".map-water")).toBeInTheDocument();

    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    const { unmount } = render(
      <LocationMapVisual place="The porch" latitude={39.2} />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    unmount();
  });

  it("shows a MapTiler static map for a saved pin", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of Sand Harbor, NV" });
    expect(map.getAttribute("src")).toContain(
      "api.maptiler.com/maps/streets-v2/static/",
    );
    expect(map.getAttribute("src")).toContain("-119.93,39.2,14/");
    expect(document.querySelector(".map-water")).toBeNull();
    expect(
      screen.getByText("© MapTiler © OpenStreetMap contributors"),
    ).toBeVisible();
  });

  it("uses a different static map for a different pin", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    const { rerender } = render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const harbor = screen
      .getByRole("img", { name: "Map of Sand Harbor, NV" })
      .getAttribute("src");
    rerender(
      <LocationMapVisual
        place="Pismo Beach"
        latitude={35.1428}
        longitude={-120.6413}
      />,
    );
    const pismo = screen
      .getByRole("img", { name: "Map of Pismo Beach" })
      .getAttribute("src");
    expect(harbor).toContain("-119.93,39.2,14/");
    expect(pismo).toContain("-120.6413,35.1428,14/");
    expect(pismo).not.toBe(harbor);
  });
});
