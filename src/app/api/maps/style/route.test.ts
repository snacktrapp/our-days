// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("map style proxy", () => {
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
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request("https://journal.example.test/api/maps/style"),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("maptiler_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a rewritten style without the MapTiler key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        glyphs:
          "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=public-key",
        sources: {
          maptiler: {
            url: "https://api.maptiler.com/tiles/v3/tiles.json?key=public-key",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request("https://journal.example.test/api/maps/style"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    const text = JSON.stringify(body);
    expect(text).toContain("/api/maps/upstream?u=");
    expect(text).not.toContain("public-key");
    expect(text).not.toContain("key=");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/maps/streets-v2/style.json",
    );
  });
});
