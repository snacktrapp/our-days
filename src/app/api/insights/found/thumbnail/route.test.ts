// @vitest-environment node

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAccess: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/journal-access", () => ({
  readJournalAccessState: mocks.readAccess,
}));

import { GET } from "./route";

describe("GET /api/insights/found/thumbnail", () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env = { ...previous, OUR_DAYS_FOUND_MODE: "enabled" };
    mocks.readAccess.mockReset();
    mocks.readAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: "m1",
      circleId: "c1",
      personId: "p1",
      role: "organizer",
    });
  });

  afterEach(() => {
    process.env = previous;
    vi.unstubAllGlobals();
  });

  it("re-encodes an allowlisted i.ytimg.com image and ignores redirects", async () => {
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 20, g: 40, b: 80 },
      },
    })
      .png()
      .toBuffer();
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
      );
      expect(init?.redirect).toBe("manual");
      return new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request(
        "http://127.0.0.1:3102/api/insights/found/thumbnail?v=abcdefghijk",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.subarray(0, 2).toString("hex")).toBe("ffd8");
  });

  it("rejects a redirect instead of following it", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/secret.jpg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request(
        "http://127.0.0.1:3102/api/insights/found/thumbnail?v=abcdefghijk",
      ),
    );
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when Found is disabled", async () => {
    delete process.env.OUR_DAYS_FOUND_MODE;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new Request(
        "http://127.0.0.1:3102/api/insights/found/thumbnail?v=abcdefghijk",
      ),
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.readAccess).not.toHaveBeenCalled();
  });
});
