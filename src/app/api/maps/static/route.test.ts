// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function request(search: string) {
  return GET(
    new Request(`https://journal.example.test/api/maps/static${search}`),
  );
}

describe("static map proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "public-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects missing or invalid coordinates", async () => {
    await expect(request("")).resolves.toMatchObject({ status: 400 });
    await expect(request("?lat=39.2")).resolves.toMatchObject({ status: 400 });
    await expect(request("?lat=99&lng=-119.93")).resolves.toMatchObject({
      status: 400,
    });
  });

  it("fails closed when the MapTiler key is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAPTILER_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("?lat=39.2&lng=-119.93")).resolves.toMatchObject({
      status: 404,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a MapTiler static map centered on the pin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: new ReadableStream(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("?lat=39.2&lng=-119.93");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/maps/streets-v2/static/-119.93,39.2,14/",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      referrerPolicy: "no-referrer",
    });
  });

  it("uses a different static map for a different pin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: new ReadableStream(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await request("?lat=39.2&lng=-119.93");
    await request("?lat=35.1428&lng=-120.6413");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/static/-119.93,39.2,14/",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/static/-120.6413,35.1428,14/",
    );
  });
});
