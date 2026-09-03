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

  it("shows a MapTiler static map centered on a saved pin", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of Sand Harbor, NV" });
    expect(map.getAttribute("src")).toBe(
      "/api/maps/static?lat=39.2&lng=-119.93",
    );
    expect(document.querySelector(".map-water")).toBeNull();
    expect(
      screen.getByText("© MapTiler © OpenStreetMap contributors"),
    ).toBeVisible();
    expect(document.querySelector(".place-pin")).toHaveStyle({
      top: "50%",
      left: "50%",
    });
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
    expect(harbor).toBe("/api/maps/static?lat=39.2&lng=-119.93");
    expect(pismo).toBe("/api/maps/static?lat=35.1428&lng=-120.6413");
    expect(pismo).not.toBe(harbor);
  });
});
