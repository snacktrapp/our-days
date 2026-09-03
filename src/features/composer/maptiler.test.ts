import { afterEach, describe, expect, it, vi } from "vitest";
import { reverseGeocodeMapTilerPlace, searchMapTilerPlaces } from "./maptiler";

describe("MapTiler geocoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("returns labeled coordinates from a forward search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            place_name: "Sand Harbor, NV",
            center: [-119.93, 39.2],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchMapTilerPlaces("Sand Harbor", "public-key"),
    ).resolves.toEqual([
      { label: "Sand Harbor, NV", latitude: 39.2, longitude: -119.93 },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/geocoding",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      referrerPolicy: "no-referrer",
    });
  });

  it("returns an empty list when the public key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchMapTilerPlaces("Sand Harbor", "")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses reverse geocoding for a pin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [{ place_name: "Ocean overlook", center: [-122.4, 37.8] }],
        }),
      }),
    );
    await expect(
      reverseGeocodeMapTilerPlace(37.8, -122.4, "public-key"),
    ).resolves.toBe("Ocean overlook");
  });
});
