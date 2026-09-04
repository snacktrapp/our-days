import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapTileViewport } from "@/features/composer/maptiler";
import { LocationMapVisual } from "./location-map-visual";

function tileHrefs(container: HTMLElement) {
  return [...container.querySelectorAll("image")].map((node) =>
    node.getAttribute("href"),
  );
}

describe("LocationMapVisual", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads same-origin raster tiles when the public key is missing", () => {
    const { container } = render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of The porch" });
    const expected = mapTileViewport(39.2, -119.93, "");
    expect(tileHrefs(container)).toEqual(
      expected?.tiles.map((tile) => tile.href),
    );
    expect(
      tileHrefs(container).every((href) => href?.startsWith("/api/maps/tile?")),
    ).toBe(true);
    expect(map).not.toHaveAttribute("style");
    expect(document.querySelector(".map-water")).toBeNull();
    expect(document.querySelector(".memory-map-live")).toBeTruthy();
    expect(document.querySelector(".place-pin")).not.toHaveAttribute("style");
  });

  it("falls back to the illustration after a tile image errors", () => {
    render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Map of The porch" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".map-water")).toBeInTheDocument();
    expect(document.querySelector(".memory-map-live")).toBeNull();
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

  it("shows MapTiler raster tiles centered on a saved pin", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    const { container } = render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const map = screen.getByRole("img", { name: "Map of Sand Harbor, NV" });
    const expected = mapTileViewport(39.2, -119.93, "public-key");
    expect(tileHrefs(container)).toEqual(
      expected?.tiles.map((tile) => tile.href),
    );
    expect(
      tileHrefs(container).every((href) =>
        href?.includes("/maps/streets-v2/256/"),
      ),
    ).toBe(true);
    expect(tileHrefs(container).join("")).not.toContain("/static/");
    expect(document.querySelector(".map-water")).toBeNull();
    expect(
      screen.getByText("© MapTiler © OpenStreetMap contributors"),
    ).toBeVisible();
    expect(document.querySelector(".memory-map-live .place-pin")).toBeTruthy();
    expect(document.querySelector(".place-pin")).not.toHaveAttribute("style");
    expect(map).toHaveAttribute("viewBox", expected?.viewBox);
  });

  it("uses different tiles for a different pin", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    const { container, rerender } = render(
      <LocationMapVisual
        place="Sand Harbor, NV"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    const harbor = tileHrefs(container);
    rerender(
      <LocationMapVisual
        place="Pismo Beach"
        latitude={35.1428}
        longitude={-120.6413}
      />,
    );
    const pismo = tileHrefs(container);
    expect(harbor[0]).toContain("/maps/streets-v2/256/");
    expect(pismo[0]).toContain("/maps/streets-v2/256/");
    expect(pismo).not.toEqual(harbor);
  });
});
