// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(search: string) {
  return GET(
    new Request(`https://journal.example.test/api/maps/geocode${search}`),
  );
}

describe("map geocode proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fails closed when the MapTiler key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_API_KEY", "");
    const response = await request("?q=Harbor");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("maptiler_key_missing");
  });

  it("returns labeled coordinates from a forward search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            { place_name: "Sand Harbor, NV", center: [-119.93, 39.2] },
          ],
        }),
      }),
    );
    const response = await request("?q=Harbor");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { label: "Sand Harbor, NV", latitude: 39.2, longitude: -119.93 },
    ]);
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/geocoding",
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Origin: "https://journal.example.test",
        Referer: "https://journal.example.test/",
      },
    });
  });

  it("surfaces an upstream geocoding failure instead of an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      }),
    );
    const response = await request("?q=San%20Luis%20Obispo");
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("maptiler_upstream_failed");
  });
});
