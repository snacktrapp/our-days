// @vitest-environment node

import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET } from "./route";

function request(search: string) {
  return GET(
    new Request(`https://journal.example.test/api/maps/static${search}`),
  );
}

describe("static map proxy", () => {
  let tilePng: Buffer;

  beforeAll(async () => {
    tilePng = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 180, g: 70, b: 60 },
      },
    })
      .png()
      .toBuffer();
  });

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
    vi.stubEnv("MAPTILER_KEY", "");
    vi.stubEnv("MAPTILER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request("?lat=39.2&lng=-119.93");
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("maptiler_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an upstream failure without leaking the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ "content-type": "text/plain" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await request("?lat=39.2&lng=-119.93");
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("maptiler_upstream_failed 403");
  });

  it("returns a raster mosaic centered on the pin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () =>
        tilePng.buffer.slice(
          tilePng.byteOffset,
          tilePng.byteOffset + tilePng.byteLength,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request("?lat=39.2&lng=-119.93");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "api.maptiler.com/maps/streets-v2/256/",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("/static/");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Referer: "https://journal.example.test/" },
    });
    const body = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(330);
  });

  it("uses different tiles for a different pin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () =>
        tilePng.buffer.slice(
          tilePng.byteOffset,
          tilePng.byteOffset + tilePng.byteLength,
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    await request("?lat=39.2&lng=-119.93");
    const harbor = fetchMock.mock.calls.map((call) => String(call[0]));
    fetchMock.mockClear();
    await request("?lat=35.1428&lng=-120.6413");
    const pismo = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(harbor[0]).toContain("/maps/streets-v2/256/");
    expect(pismo[0]).toContain("/maps/streets-v2/256/");
    expect(pismo).not.toEqual(harbor);
  });
});
