import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapTilerRasterTileUrl,
  mapTilerStaticMapUrl,
  mapTilerUpstreamProxySrc,
  mapTileViewport,
  reverseGeocodeMapTilerPlace,
  rewriteMapTilerStyleDocument,
  searchMapTilerPlaces,
  searchPlacesForComposer,
  serverMapTilerKey,
  staticMapImageSrc,
} from "./maptiler";

describe("MapTiler geocoding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
      method: "GET",
    });
  });

  it("fails the search when MapTiler geocoding is not available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      }),
    );
    await expect(
      searchMapTilerPlaces("Harbor", "public-key"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("reads a GeoJSON pin when center is omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              text: "San Luis Obispo",
              geometry: { coordinates: [-120.6596, 35.2828] },
            },
          ],
        }),
      }),
    );
    await expect(
      searchMapTilerPlaces("San Luis Obispo", "public-key"),
    ).resolves.toEqual([
      {
        label: "San Luis Obispo",
        latitude: 35.2828,
        longitude: -120.6596,
      },
    ]);
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

  it("builds raster tiles centered on a saved pin", () => {
    const harbor = mapTileViewport(39.2, -119.93, "public-key");
    const pismo = mapTileViewport(35.1428, -120.6413, "public-key");
    expect(harbor?.tiles.length).toBeGreaterThan(0);
    expect(pismo?.tiles.length).toBeGreaterThan(0);
    expect(harbor?.tiles[0]?.href).toBe(
      mapTilerRasterTileUrl(
        "public-key",
        harbor!.tiles[0]!.z,
        harbor!.tiles[0]!.x,
        harbor!.tiles[0]!.y,
      ),
    );
    expect(harbor?.tiles.map((tile) => tile.href)).not.toEqual(
      pismo?.tiles.map((tile) => tile.href),
    );
    expect(mapTilerRasterTileUrl("", 14, 1, 1)).toBe("");
    expect(mapTilerStaticMapUrl("", 39.2, -119.93)).toBe("");
    expect(staticMapImageSrc(39.2, -119.93)).toBe(
      "/api/maps/static?lat=39.2&lng=-119.93",
    );
    expect(staticMapImageSrc(35.1428, -120.6413)).toBe(
      "/api/maps/static?lat=35.1428&lng=-120.6413",
    );
  });

  it("reads the server MapTiler key from runtime env names", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_KEY", "server-key");
    expect(serverMapTilerKey()).toBe("server-key");
    vi.unstubAllEnvs();
  });

  it("searches through the same-origin geocode proxy without a public key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { label: "Sand Harbor, NV", latitude: 39.2, longitude: -119.93 },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchPlacesForComposer("Harbor")).resolves.toEqual([
      { label: "Sand Harbor, NV", latitude: 39.2, longitude: -119.93 },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/maps/geocode?q=Harbor",
    );
  });

  it("keeps the static image on the same-origin tile stitch", () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
    expect(staticMapImageSrc(39.2, -119.93)).toBe(
      "/api/maps/static?lat=39.2&lng=-119.93",
    );
    expect(staticMapImageSrc(35.1428, -120.6413)).toBe(
      "/api/maps/static?lat=35.1428&lng=-120.6413",
    );
    const viewport = mapTileViewport(39.2, -119.93, "public-key");
    expect(
      viewport?.tiles.every((tile) =>
        tile.href.includes("/maps/streets-v2/256/"),
      ),
    ).toBe(true);
    vi.unstubAllEnvs();
  });

  it("rewrites MapTiler style URLs onto same-origin proxies without the key", () => {
    const rewritten = rewriteMapTilerStyleDocument({
      sources: {
        maptiler: {
          url: "https://api.maptiler.com/tiles/v3/tiles.json?key=secret-key",
        },
      },
      glyphs:
        "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=secret-key",
    });
    const text = JSON.stringify(rewritten);
    expect(text).toContain("/api/maps/upstream?u=");
    expect(text).not.toContain("secret-key");
    expect(text).not.toContain("key=");
    expect(
      mapTilerUpstreamProxySrc(
        new URL("https://api.maptiler.com/tiles/v3/tiles.json?key=secret-key"),
      ),
    ).not.toContain("secret-key");
  });
});
