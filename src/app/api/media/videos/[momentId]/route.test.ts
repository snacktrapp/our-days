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
const privateCachedHeader = "private, max-age=604800, immutable";

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
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
    expect(response.headers.get("vary")).toBe("Cookie, Range");
    expect(response.headers.get("etag")).toMatch(/^"od-media-[0-9a-f]{64}"$/u);
    expect(response.headers.get("content-length")).toBe("10");
    expect(mocks.rpc).toHaveBeenCalledWith("get_video_moment_delivery", {
      moment_id: momentId,
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledWith("video/private", 60);
    const init = mocks.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
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
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
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
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("still proxies when Storage omits MIME type or returns size as a string", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: "10" }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(10), {
        status: 200,
        headers: {
          "content-length": "10",
          "content-type": "application/octet-stream",
        },
      }),
    );
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("still slices a Safari Range probe when Storage omits Content-Length", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, mime_type: "video/quicktime" }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );
    const response = await request("bytes=0-1");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(response.headers.get("content-type")).toBe("video/quicktime");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  it("turns a full 200 for a Safari Range probe into a truthful 206", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
        status: 200,
        headers: { "content-length": "10", "content-type": "video/mp4" },
      }),
    );
    const response = await request("bytes=0-1");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(response.headers.get("content-length")).toBe("2");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  it("fails closed when Storage omits Content-Length and the body is shorter than the descriptor", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );
    const response = await request("bytes=0-1");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("content-range")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("fails closed when the private descriptor or upstream shape changes", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await request()).headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );

    mocks.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(9), {
        status: 200,
        headers: { "content-length": "9", "content-type": "video/mp4" },
      }),
    );
    const mismatched = await request();
    expect(mismatched.status).toBe(404);
    expect(mismatched.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("rewrites an open-ended range to a 1 MiB window", async () => {
    const size = 5_000_000;
    const windowEnd = 1_048_575;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(windowEnd + 1), {
        status: 206,
        headers: {
          "content-length": String(windowEnd + 1),
          "content-range": `bytes 0-${windowEnd}/${size}`,
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-${windowEnd}/${size}`,
    );
    expect(response.headers.get("content-length")).toBe(String(windowEnd + 1));
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
    expect(response.headers.get("vary")).toBe("Cookie, Range");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({
        headers: { Range: `bytes=0-${windowEnd}` },
        signal: expect.any(AbortSignal),
      }),
    );
    expect((await response.arrayBuffer()).byteLength).toBe(windowEnd + 1);
  });

  it("clamps an open-ended range to the last byte of a small file", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(10), {
        status: 206,
        headers: {
          "content-length": "10",
          "content-range": "bytes 0-9/10",
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-9/10");
    expect(response.headers.get("content-length")).toBe("10");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({ headers: { Range: "bytes=0-9" } }),
    );
  });

  it("clamps an explicit range that is larger than the window", async () => {
    const size = 4_000_000;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(1_048_576), {
        status: 206,
        headers: {
          "content-length": "1048576",
          "content-range": `bytes 0-1048575/${size}`,
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-2097151");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-1048575/${size}`,
    );
    expect(response.headers.get("content-length")).toBe("1048576");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({ headers: { Range: "bytes=0-1048575" } }),
    );
  });

  it("serves a short suffix from the end of the file", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array([7, 8, 9, 10]), {
        status: 206,
        headers: {
          "content-length": "4",
          "content-range": "bytes 6-9/10",
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=-4");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 6-9/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({ headers: { Range: "bytes=6-9" } }),
    );
  });

  it("bounds a suffix range to the same window", async () => {
    const size = 3_000_000;
    const suffix = 2_097_152;
    const start = size - suffix;
    const end = start + 1_048_576 - 1;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(end - start + 1), {
        status: 206,
        headers: {
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request(`bytes=-${suffix}`);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${start}-${end}/${size}`,
    );
    expect(response.headers.get("content-length")).toBe(
      String(end - start + 1),
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({
        headers: { Range: `bytes=${start}-${end}` },
      }),
    );
  });

  it("leaves a valid bounded range unchanged", async () => {
    const size = 5_000_000;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    mocks.fetch.mockResolvedValue(
      new Response(new Uint8Array(4096), {
        status: 206,
        headers: {
          "content-length": "4096",
          "content-range": `bytes 4096-8191/${size}`,
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=4096-8191");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 4096-8191/${size}`,
    );
    expect(response.headers.get("content-length")).toBe("4096");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({ headers: { Range: "bytes=4096-8191" } }),
    );
  });

  it("does not stream past the window when Storage returns the rest of the file", async () => {
    const size = 3_000_000;
    const windowBytes = 1_048_576;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    let pulled = 0;
    const chunkSize = 256 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= size) {
          controller.close();
          return;
        }
        const next = Math.min(chunkSize, size - pulled);
        pulled += next;
        controller.enqueue(new Uint8Array(next));
      },
    });
    mocks.fetch.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "content-length": String(size),
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-${windowBytes - 1}/${size}`,
    );
    expect(response.headers.get("content-length")).toBe(String(windowBytes));
    expect((await response.arrayBuffer()).byteLength).toBe(windowBytes);
    // The response body queues one chunk before cancel reaches the source.
    expect(pulled).toBeGreaterThanOrEqual(windowBytes);
    expect(pulled).toBeLessThanOrEqual(windowBytes + chunkSize);
    expect(pulled).toBeLessThan(size);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      expect.objectContaining({
        headers: { Range: `bytes=0-${windowBytes - 1}` },
      }),
    );
  });

  it("truncates an upstream 206 that continues past the bounded window", async () => {
    const size = 3_000_000;
    const windowBytes = 1_048_576;
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, size_bytes: size }],
      error: null,
    });
    let pulled = 0;
    const chunkSize = 256 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= size) {
          controller.close();
          return;
        }
        const next = Math.min(chunkSize, size - pulled);
        pulled += next;
        controller.enqueue(new Uint8Array(next));
      },
    });
    mocks.fetch.mockResolvedValue(
      new Response(stream, {
        status: 206,
        headers: {
          "content-length": String(size),
          "content-range": `bytes 0-${size - 1}/${size}`,
          "content-type": "video/mp4",
        },
      }),
    );
    const response = await request("bytes=0-");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 0-${windowBytes - 1}/${size}`,
    );
    expect(response.headers.get("content-length")).toBe(String(windowBytes));
    expect((await response.arrayBuffer()).byteLength).toBe(windowBytes);
    expect(pulled).toBeGreaterThanOrEqual(windowBytes);
    expect(pulled).toBeLessThanOrEqual(windowBytes + chunkSize);
    expect(pulled).toBeLessThan(size);
  });

  it("passes request.signal to the upstream fetch and fails closed when that fetch aborts", async () => {
    const controller = new AbortController();
    const incoming = new Request(
      `https://journal.example.test/api/media/videos/${momentId}`,
      {
        headers: { Range: "bytes=0-" },
        signal: controller.signal,
      },
    );
    controller.abort();
    let received: AbortSignal | undefined;
    mocks.fetch.mockImplementation((_url: string, init?: RequestInit) => {
      received = init?.signal ?? undefined;
      return Promise.reject(
        new DOMException("The operation was aborted.", "AbortError"),
      );
    });
    const response = await GET(incoming, {
      params: Promise.resolve({ momentId }),
    });
    expect(incoming.signal.aborted).toBe(true);
    expect(received).toBe(incoming.signal);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("content-range")).toBeNull();
  });
});
