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
  });
});
