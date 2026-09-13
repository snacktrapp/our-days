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
  bucket_id: "our-days-display",
  object_path: "display/private/photo.webp",
  output_mime_type: "image/webp",
  output_size_bytes: 5,
  output_sha256_hex:
    "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0",
  output_width: 1200,
  output_height: 800,
  photo_id: "10000000-0000-4000-8000-000000000011",
  sort_order: 0,
};
const secondDescriptor = {
  ...descriptor,
  object_path: "display/private/photo-2.webp",
  photo_id: "10000000-0000-4000-8000-000000000012",
  sort_order: 1,
};

function request(id = momentId) {
  return GET(new Request(`https://journal.example.test/api/media/${id}`), {
    params: Promise.resolve({ momentId: id }),
  });
}

function signedBytes(
  values: number[],
  contentType = "image/webp",
  status = 200,
) {
  mocks.createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://storage.example.test/signed-photo" },
    error: null,
  });
  mocks.fetch.mockResolvedValue(
    new Response(Uint8Array.from(values), {
      status,
      headers: {
        "content-length": String(values.length),
        "content-type": contentType,
      },
    }),
  );
}

describe("private photo delivery route", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_MEDIA_DELIVERY_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.rpc.mockResolvedValue({
      data: [descriptor, secondDescriptor],
      error: null,
    });
    mocks.from.mockReturnValue({ createSignedUrl: mocks.createSignedUrl });
    mocks.createClient.mockResolvedValue({
      rpc: mocks.rpc,
      storage: { from: mocks.from },
    });
    vi.stubGlobal("fetch", mocks.fetch);
    signedBytes([1, 2, 3, 4, 5]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("fails closed before touching Supabase when app delivery is disabled", async () => {
    vi.stubEnv("OUR_DAYS_MEDIA_DELIVERY_MODE", "disabled");
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });

  it("streams only the descriptor-bound private object without shared caching", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(mocks.rpc).toHaveBeenCalledWith("get_photo_moment_delivery", {
      moment_id: momentId,
    });
    expect(mocks.from).toHaveBeenCalledWith("our-days-display");
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "display/private/photo.webp",
      60,
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://storage.example.test/signed-photo",
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4, 5]),
    );
  });

  it.each([
    ["invalid id", "not-a-uuid"],
    ["missing descriptor", momentId],
  ])("returns the same neutral response for %s", async (label, id) => {
    void label;
    if (id === momentId) mocks.rpc.mockResolvedValue({ data: [], error: null });
    const response = await request(id);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("streams a specific album photo when photo is requested", async () => {
    const response = await GET(
      new Request(
        `https://journal.example.test/api/media/${momentId}?photo=${secondDescriptor.photo_id}`,
      ),
      { params: Promise.resolve({ momentId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      "display/private/photo-2.webp",
      60,
    );
  });

  it("returns the same neutral response for an unknown photo id", async () => {
    const response = await GET(
      new Request(
        `https://journal.example.test/api/media/${momentId}?photo=10000000-0000-4000-8000-000000000099`,
      ),
      { params: Promise.resolve({ momentId }) },
    );
    expect(response.status).toBe(404);
  });

  it("still streams when Storage omits MIME type or returns size as a string", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, output_size_bytes: "5" }],
      error: null,
    });
    signedBytes([1, 2, 3, 4, 5], "");
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("fails closed when Storage cannot mint a signed URL", async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("still streams when the descriptor digest is prefixed or uppercase", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_sha256_hex: `\\x${descriptor.output_sha256_hex.toUpperCase()}`,
        },
      ],
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("rejects bytes whose verified size, type, or digest no longer matches", async () => {
    signedBytes([1, 2], "image/png");
    const response = await request();
    expect(response.status).toBe(404);

    signedBytes([5, 4, 3, 2, 1]);
    const sameShapeCorruption = await request();
    expect(sameShapeCorruption.status).toBe(404);
  });
});
