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
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("maptiler_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the MapTiler style document", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      body: new ReadableStream(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/maps/streets-v2/style.json",
    );
  });
});
