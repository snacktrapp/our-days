// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(search: string) {
  return GET(
    new Request(`https://journal.example.test/api/maps/tile${search}`),
  );
}

describe("map tile proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects missing or invalid tiles", async () => {
    await expect(request("")).resolves.toMatchObject({ status: 400 });
    await expect(request("?z=14&x=-1&y=1")).resolves.toMatchObject({
      status: 400,
    });
    await expect(request("?z=99&x=1&y=1")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("fails closed when the MapTiler key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request("?z=14&x=1&y=1");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("maptiler_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a MapTiler raster tile", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: new ReadableStream(),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await request("?z=14&x=2701&y=6250");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/maps/streets-v2/256/14/2701/6250.png",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Referer: "https://journal.example.test/" },
    });
  });
});
