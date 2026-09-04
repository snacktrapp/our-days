import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { staticMapImageSrc } from "@/features/composer/maptiler";
import { LocationMapVisual } from "./location-map-visual";

describe("LocationMapVisual", () => {
  it("loads the same-origin static map without a public MapTiler key", () => {
    render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of The porch" });
    expect(map).toHaveAttribute("src", staticMapImageSrc(39.2, -119.93));
    expect(map).toHaveAttribute("src", "/api/maps/static?lat=39.2&lng=-119.93");
    expect(map).not.toHaveAttribute("style");
    expect(document.querySelector(".map-water")).toBeNull();
    expect(document.querySelector("svg")).toBeNull();
    expect(document.querySelector(".memory-map-live")).toBeTruthy();
    expect(document.querySelector(".place-pin")).not.toHaveAttribute("style");
  });

  it("hides the map image after the static image errors instead of a placeholder", () => {
    render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Map of The porch" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".map-water")).toBeNull();
    expect(document.querySelector(".memory-map-live")).toBeNull();
    expect(document.querySelector(".place-pin")).toBeTruthy();
  });

  it("does not invent a placeholder map when coordinates are missing", () => {
    render(<LocationMapVisual place="The porch" />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".map-water")).toBeNull();
    expect(document.querySelector(".place-pin")).toBeTruthy();

    render(<LocationMapVisual place="The porch" latitude={39.2} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".map-water")).toBeNull();
  });

  it("shows a static map centered on a saved pin", () => {
    render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of Sand Harbor, NV" });
    expect(map).toHaveAttribute("src", "/api/maps/static?lat=39.2&lng=-119.93");
    expect(document.querySelector(".map-water")).toBeNull();
    expect(
      screen.getByText("© MapTiler © OpenStreetMap contributors"),
    ).toBeVisible();
    expect(document.querySelector(".memory-map-live .place-pin")).toBeTruthy();
    expect(document.querySelector(".place-pin")).not.toHaveAttribute("style");
  });

  it("uses a different static image for a different pin", () => {
    const { rerender } = render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/maps/static?lat=39.2&lng=-119.93",
    );
    rerender(
      <LocationMapVisual
        place="Pismo Beach"
        latitude={35.1428}
        longitude={-120.6413}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/maps/static?lat=35.1428&lng=-120.6413",
    );
  });
});
