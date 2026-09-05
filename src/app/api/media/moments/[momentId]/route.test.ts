// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  download: vi.fn(),
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

describe("private photo delivery route", () => {
  beforeEach(() => {
    vi.stubEnv("OUR_DAYS_MEDIA_DELIVERY_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.rpc.mockResolvedValue({
      data: [descriptor, secondDescriptor],
      error: null,
    });
    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
        type: "image/webp",
      }),
      error: null,
    });
    mocks.from.mockReturnValue({ download: mocks.download });
    mocks.createClient.mockResolvedValue({
      rpc: mocks.rpc,
      storage: { from: mocks.from },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(mocks.download).toHaveBeenCalledWith(
      "display/private/photo.webp",
      {},
      { cache: "no-store" },
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
    expect(mocks.download).toHaveBeenCalledWith(
      "display/private/photo-2.webp",
      {},
      { cache: "no-store" },
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

  it("rejects bytes whose verified size, type, or digest no longer matches", async () => {
    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
      error: null,
    });
    const response = await request();
    expect(response.status).toBe(404);

    mocks.download.mockResolvedValue({
      data: new Blob([new Uint8Array([5, 4, 3, 2, 1])], {
        type: "image/webp",
      }),
      error: null,
    });
    const sameShapeCorruption = await request();
    expect(sameShapeCorruption.status).toBe(404);
  });
});
