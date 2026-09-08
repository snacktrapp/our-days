import { describe, expect, it } from "vitest";
import {
  parsePlaceCoordinates,
  shortPlaceLabel,
  buildAppleMapsUrl,
  validPlaceCoordinates,
} from "./place-coordinates";

describe("place coordinates", () => {
  it("accepts a WGS84 pair and rejects a half-filled or out-of-range pair", () => {
    expect(parsePlaceCoordinates(39.2, -119.93)).toEqual({
      latitude: 39.2,
      longitude: -119.93,
    });
    expect(parsePlaceCoordinates(0, 0)).toEqual({
      latitude: 0,
      longitude: 0,
    });
    expect(parsePlaceCoordinates(39.2, undefined)).toBeNull();
    expect(parsePlaceCoordinates(91, 0)).toBeNull();
    expect(validPlaceCoordinates(undefined, undefined)).toBe(true);
    expect(validPlaceCoordinates(39.2, -119.93)).toBe(true);
    expect(validPlaceCoordinates(39.2, undefined)).toBe(false);
  });

  it("keeps the short display name and drops the rest of an address", () => {
    expect(shortPlaceLabel("Sand Harbor, NV, United States")).toBe(
      "Sand Harbor",
    );
    expect(shortPlaceLabel("Oak Street School")).toBe("Oak Street School");
    expect(shortPlaceLabel("  The porch  ")).toBe("The porch");
  });

  it("builds an Apple Maps link with coordinates and the short name", () => {
    expect(
      buildAppleMapsUrl("Bass Lake, CA, United States", 37.3247, -119.5664),
    ).toBe("https://maps.apple.com/?ll=37.3247,-119.5664&q=Bass%20Lake&z=14");
    expect(buildAppleMapsUrl("The porch", 35.28, -120.66)).toBe(
      "https://maps.apple.com/?ll=35.28,-120.66&q=The%20porch&z=14",
    );
    expect(buildAppleMapsUrl("Oak Street School", null, null)).toBeNull();
  });
});
