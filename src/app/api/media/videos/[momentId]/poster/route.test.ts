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
  mime_type: "image/jpeg",
  object_path: "poster/10000000-0000-4000-8000-000000000001",
  size_bytes: 4,
};

function request(id = momentId) {
  return GET(
    new Request(`https://journal.example.test/api/media/videos/${id}/poster`),
    { params: Promise.resolve({ momentId: id }) },
  );
}

describe("private video poster delivery route", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_MEDIA_DELIVERY_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.rpc.mockResolvedValue({ data: [descriptor], error: null });
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed-poster" },
      error: null,
    });
    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createClient.mockResolvedValue({
      rpc: mocks.rpc,
      storage: { from: mocks.from },
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-length": "4", "content-type": "image/jpeg" },
      }),
    );
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("proxies the signed poster without shared caching", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("get_video_moment_poster_delivery", {
      moment_id: momentId,
    });
    expect(mocks.from).toHaveBeenCalledWith("our-days-videos");
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "poster/10000000-0000-4000-8000-000000000001",
      60,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("still proxies when Storage omits MIME type or returns size as a string", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: "4" }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("fails closed when the signed URL cannot be minted", async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    expect((await request()).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the private descriptor is missing", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await request()).status).toBe(404);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
