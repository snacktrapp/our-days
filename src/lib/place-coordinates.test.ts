import { describe, expect, it } from "vitest";
import {
  parsePlaceCoordinates,
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
});
