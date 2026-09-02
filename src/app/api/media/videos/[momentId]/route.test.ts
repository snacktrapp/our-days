// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSignedUrl: vi.fn(),
  fetch: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import { GET } from "./route";

const momentId = "10000000-0000-4000-8000-000000000001";
const descriptor = {
  bucket_id: "our-days-videos",
  duration_ms: 2_000,
  mime_type: "video/mp4",
  object_path: "video/private",
  size_bytes: 10,
};

function request(range?: string) {
  return GET(
    new Request(`https://journal.example.test/api/media/videos/${momentId}`, {
      headers: range ? { Range: range } : undefined,
    }),
    { params: Promise.resolve({ momentId }) },
  );
}

describe("private video delivery route", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_MEDIA_DELIVERY_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.rpc.mockResolvedValue({ data: [descriptor], error: null });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed" },
      error: null,
    });
    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createClient.mockResolvedValue({
      rpc: mocks.rpc,
      storage: { from: mocks.from },
    });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("proxies a descriptor-bound full response without shared caching", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(10), {
        status: 200,
        headers: { "content-length": "10", "content-type": "video/mp4" },
      }),
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("get_video_moment_delivery", {
      moment_id: momentId,
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith("video/private", 60);
  });

  it("passes one validated byte range and preserves the partial response", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(5), {
        status: 206,
        headers: {
          "content-length": "5",
          "content-range": "bytes 0-4/10",
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-4");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-4/10");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({ headers: { Range: "bytes=0-4" } }),
    );
  });

  it.each(["bytes=0-1,4-5", "items=0-1", "bytes=-"])(
    "rejects unsafe range %s before storage access",
    async (range) => {
      const response = await request(range);
      expect(response.status).toBe(404);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the private descriptor or upstream shape changes", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await request()).status).toBe(404);

    mocks.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(9), {
        status: 200,
        headers: { "content-length": "9", "content-type": "video/mp4" },
      }),
    );
    expect((await request()).status).toBe(404);
  });
});
