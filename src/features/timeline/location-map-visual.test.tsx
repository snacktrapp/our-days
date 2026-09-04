import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocationMapVisual } from "./location-map-visual";

describe("LocationMapVisual", () => {
  it("does not paint map chrome for this ship", () => {
    const { container } = render(
      <LocationMapVisual
        place="The porch"
        latitude={39.2}
        longitude={-119.93}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(document.querySelector(".memory-map")).toBeNull();
    expect(document.querySelector(".place-pin")).toBeNull();
    expect(document.querySelector(".map-water")).toBeNull();
  });

  it("stays empty when coordinates are missing", () => {
    const { container } = render(<LocationMapVisual place="The porch" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
