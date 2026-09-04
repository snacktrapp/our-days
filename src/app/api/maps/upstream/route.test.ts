// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(search: string) {
  return GET(
    new Request(`https://journal.example.test/api/maps/upstream${search}`),
  );
}

describe("map upstream proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects URLs that are not MapTiler", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(
      `?u=${encodeURIComponent("https://example.test/tiles.json")}`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("invalid_upstream");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a MapTiler URL with the server key and rewrites JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        tiles: [
          "https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=public-key",
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await request(
      `?u=${encodeURIComponent("https://api.maptiler.com/tiles/v3/tiles.json")}`,
    );
    expect(response.status).toBe(200);
    const forwarded = String(fetchMock.mock.calls[0]?.[0]);
    expect(forwarded).toContain("api.maptiler.com/tiles/v3/tiles.json");
    expect(forwarded).toContain("key=public-key");
    const body = JSON.stringify(await response.json());
    expect(body).toContain("/api/maps/upstream?u=");
    expect(body).not.toContain("public-key");
    expect(body).not.toContain("key=");
  });
});
