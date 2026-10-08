// @vitest-environment node

import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCardRenditionCache,
  rememberCardRendition,
} from "@/lib/card-photo-rendition.server";
import { clearVerifiedPrivateMediaCacheForTests } from "@/lib/private-media-delivery.server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createSignedUrl: vi.fn(),
  fetch: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
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
const privateCachedHeader = "private, max-age=604800, immutable";

function request(id = momentId, search = "") {
  return GET(
    new Request(`https://journal.example.test/api/media/${id}${search}`),
    {
      params: Promise.resolve({ momentId: id }),
    },
  );
}

async function wideWebp(width = 1400, height = 900) {
  const bytes = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 70, b: 120 },
    },
  })
    .webp({ quality: 80 })
    .withMetadata({
      exif: { IFD0: { Copyright: "private-note" } },
    })
    .toBuffer();
  return {
    bytes,
    sha: createHash("sha256").update(bytes).digest("hex"),
  };
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
    clearVerifiedPrivateMediaCacheForTests();
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
    clearVerifiedPrivateMediaCacheForTests();
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
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("etag")).toMatch(/^"od-media-[0-9a-f]{64}"$/u);
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
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
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
    expect((await request()).status).toBe(404);
  });

  it("returns a neutral 404 when get_photo_moment_delivery has no live session or capability", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Family session is unavailable" },
    });
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("still opens matching SHA bytes when the signed fetch omits MIME or stringifies size", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...descriptor, output_size_bytes: "5" as unknown as number }],
      error: null,
    });
    signedBytes([1, 2, 3, 4, 5], "");
    expect((await request()).status).toBe(200);

    mocks.rpc.mockResolvedValue({ data: [descriptor], error: null });
    signedBytes([1, 2, 3, 4, 5], "application/octet-stream");
    const octet = await request();
    expect(octet.status).toBe(200);
    expect(octet.headers.get("content-type")).toBe("image/webp");
    expect(mocks.createSignedUrl).toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalled();
  });

  it("rejects a width outside the card allow-list with a neutral 404", async () => {
    mocks.rpc.mockResolvedValue({ data: [descriptor], error: null });
    const response = await request(momentId, "?w=200");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(mocks.fetch).not.toHaveBeenCalled();

    const oversized = await request(momentId, "?w=1920");
    expect(oversized.status).toBe(404);
    expect(await oversized.text()).toBe("");
  });

  it("returns a neutral 404 when the resized source has the wrong size or MIME", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength + 1,
          output_sha256_hex: source.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    const wrongSize = await request(momentId, "?w=1080");
    expect(wrongSize.status).toBe(404);
    expect(await wrongSize.text()).toBe("");

    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: source.sha,
          output_mime_type: "image/jpeg",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    const wrongMime = await request(momentId, "?w=640");
    expect(wrongMime.status).toBe(404);
    expect(await wrongMime.text()).toBe("");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the unresized full-view path on the verified display bytes", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: source.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    const response = await request(momentId, `?photo=${descriptor.photo_id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("server-timing")).toContain("resize;dur=0");
    expect(response.headers.get("server-timing")).toContain("queue;dur=0");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(source.bytes);
  });

  it("does not serve a cached rendition when authorization fails", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: source.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    expect((await request(momentId, "?w=1080")).status).toBe(200);

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Family session is unavailable" },
    });
    const denied = await request(momentId, "?w=1080");
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("verifies the display derivative before resizing it to the card width", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: source.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    const response = await request(momentId, "?w=1080");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
    const timing = response.headers.get("server-timing") ?? "";
    expect(timing).toContain("auth;dur=");
    expect(timing).toContain("fetch;dur=");
    expect(timing).toContain("queue;dur=");
    expect(timing).toContain("resize;dur=");
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.byteLength).toBeLessThan(source.bytes.byteLength);
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1080);
    expect(meta.exif).toBeUndefined();
    expect(body.includes(Buffer.from("private-note"))).toBe(false);

    const small = await wideWebp(400, 300);
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: small.bytes.byteLength,
          output_sha256_hex: small.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...small.bytes], "image/webp");
    const unscaled = await request(momentId, "?w=1080");
    expect(unscaled.status).toBe(200);
    const unscaledMeta = await sharp(
      Buffer.from(await unscaled.arrayBuffer()),
    ).metadata();
    expect(unscaledMeta.width).toBe(400);
    expect(unscaledMeta.height).toBe(300);
  });

  it("returns a neutral 404 when the bytes hashed for resize do not match", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: "a".repeat(64),
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    const response = await request(momentId, "?w=640");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("reuses a verified card rendition without fetching the source again", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          output_size_bytes: source.bytes.byteLength,
          output_sha256_hex: source.sha,
          output_mime_type: "image/webp",
        },
      ],
      error: null,
    });
    signedBytes([...source.bytes], "image/webp");
    expect((await request(momentId, "?w=640")).status).toBe(200);
    signedBytes([...source.bytes], "image/webp");
    const cached = await request(momentId, "?w=640");
    expect(cached.status).toBe(200);
    expect(cached.headers.get("server-timing")).toContain("resize;dur=0");
    expect(cached.headers.get("server-timing")).toContain("queue;dur=0");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  function signObjects(
    objects: Record<string, { bytes: Uint8Array; type?: string }>,
  ) {
    mocks.createSignedUrl.mockImplementation(async (path: string) => ({
      data: {
        signedUrl: `https://storage.example.test/${encodeURIComponent(path)}`,
      },
      error: null,
    }));
    mocks.fetch.mockImplementation(async (url: string) => {
      const path = decodeURIComponent(
        String(url).replace("https://storage.example.test/", ""),
      );
      const object = objects[path];
      if (!object) return new Response(null, { status: 404 });
      return new Response(Uint8Array.from(object.bytes), {
        status: 200,
        headers: {
          "content-length": String(object.bytes.byteLength),
          "content-type": object.type ?? "image/webp",
        },
      });
    });
  }

  it("serves the stored card for an album frame without resizing", async () => {
    clearCardRenditionCache();
    const card = await sharp({
      create: {
        background: { b: 9, g: 8, r: 7 },
        channels: 3,
        height: 12,
        width: 20,
      },
    })
      .webp({ quality: 73 })
      .toBuffer();
    const cardSha = createHash("sha256").update(card).digest("hex");
    const cardPath = `${secondDescriptor.object_path}.card-1080.webp`;
    mocks.rpc.mockResolvedValue({
      data: [
        descriptor,
        {
          ...secondDescriptor,
          card_renditions: [
            {
              bucket_id: "our-days-display",
              mime_type: "image/webp",
              object_path: cardPath,
              output_height: 12,
              output_width: 20,
              sha256_hex: cardSha,
              size_bytes: card.byteLength,
              width: 1080,
            },
          ],
        },
      ],
      error: null,
    });
    signObjects({ [cardPath]: { bytes: card } });
    const response = await request(
      momentId,
      `?photo=${secondDescriptor.photo_id}&w=1080`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(privateCachedHeader);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("server-timing")).toContain("resize;dur=0");
    expect(response.headers.get("server-timing")).toContain("queue;dur=0");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(card);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(cardPath, 60);

    const repeated = await request(
      momentId,
      `?photo=${secondDescriptor.photo_id}&w=1080`,
    );
    expect(repeated.status).toBe(200);
    expect(Buffer.from(await repeated.arrayBuffer())).toEqual(card);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("falls back to on-demand resize when no stored card exists", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          card_renditions: [],
          output_mime_type: "image/webp",
          output_sha256_hex: source.sha,
          output_size_bytes: source.bytes.byteLength,
        },
      ],
      error: null,
    });
    signObjects({
      [descriptor.object_path]: { bytes: source.bytes },
    });
    const response = await request(momentId, "?w=1080");
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(source.bytes)).toBe(false);
    expect((await sharp(body).metadata()).width).toBe(1080);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      descriptor.object_path,
      60,
    );
  });

  it("falls back when the stored card digest does not match and serves no bad bytes", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    const claimed = Buffer.from("stored-card-bytes");
    const bad = Buffer.from("stored-card-byte!");
    const cardPath = `${descriptor.object_path}.card-1080.webp`;
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          card_renditions: [
            {
              bucket_id: "our-days-display",
              mime_type: "image/webp",
              object_path: cardPath,
              output_height: 10,
              output_width: 10,
              sha256_hex: createHash("sha256").update(claimed).digest("hex"),
              size_bytes: claimed.byteLength,
              width: 1080,
            },
          ],
          output_mime_type: "image/webp",
          output_sha256_hex: source.sha,
          output_size_bytes: source.bytes.byteLength,
        },
      ],
      error: null,
    });
    signObjects({
      [cardPath]: { bytes: bad },
      [descriptor.object_path]: { bytes: source.bytes },
    });
    const response = await request(momentId, "?w=1080");
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(bad)).toBe(false);
    expect(body.equals(claimed)).toBe(false);
    expect((await sharp(body).metadata()).width).toBe(1080);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the no-width response on the display bytes when a card exists", async () => {
    clearCardRenditionCache();
    const source = await wideWebp();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...descriptor,
          card_renditions: [
            {
              bucket_id: "our-days-display",
              mime_type: "image/webp",
              object_path: `${descriptor.object_path}.card-1080.webp`,
              sha256_hex: "ab".repeat(32),
              size_bytes: 4,
              width: 1080,
            },
          ],
          output_mime_type: "image/webp",
          output_sha256_hex: source.sha,
          output_size_bytes: source.bytes.byteLength,
        },
      ],
      error: null,
    });
    signObjects({
      [descriptor.object_path]: { bytes: source.bytes },
    });
    const response = await request(momentId, `?photo=${descriptor.photo_id}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(source.bytes);
    expect(response.headers.get("server-timing")).toContain("resize;dur=0");
    expect(response.headers.get("server-timing")).toContain("queue;dur=0");
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedUrl).toHaveBeenCalledWith(
      descriptor.object_path,
      60,
    );
  });

  it("returns 404 before cache or storage when the moment is unauthorized or unknown", async () => {
    clearCardRenditionCache();
    rememberCardRendition(
      descriptor.output_sha256_hex,
      1080,
      Uint8Array.from([7, 7, 7]),
    );
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Family session is unavailable" },
    });
    const denied = await request(momentId, "?w=1080");
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe("");
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.createClient.mockClear();
    const unknown = await request("not-a-uuid", "?w=1080");
    expect(unknown.status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
