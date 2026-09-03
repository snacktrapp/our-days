import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationMapVisual } from "./location-map-visual";

describe("LocationMapVisual", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the same-origin proxy when the public key is missing", () => {
    render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Map of The porch" }),
    ).toHaveAttribute("src", "/api/maps/static?lat=39.2&lng=-119.93");
  });

  it("keeps the illustration when coordinates are missing", () => {
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
      "https://api.maptiler.com/maps/streets-v2/static/-119.93,39.2,14/800x330.png?key=public-key",
    );
    expect(map).toHaveAttribute("referrerPolicy", "no-referrer");
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
    expect(harbor).toBe(
      "https://api.maptiler.com/maps/streets-v2/static/-119.93,39.2,14/800x330.png?key=public-key",
    );
    expect(pismo).toBe(
      "https://api.maptiler.com/maps/streets-v2/static/-120.6413,35.1428,14/800x330.png?key=public-key",
    );
    expect(pismo).not.toBe(harbor);
  });
});
