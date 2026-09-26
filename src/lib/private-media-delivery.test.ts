import { describe, expect, it, vi } from "vitest";
import {
  byteSizeMatches,
  clearSignedPrivateUrls,
  contentLengthAgrees,
  declaredByteSize,
  fetchSignedPrivateObject,
  mediaTypeMatches,
  privateMediaRetrySrc,
  sha256HexMatches,
  streamVerifiedBytes,
  warmSignedPhotoUrls,
} from "./private-media-delivery";

describe("private media delivery checks", () => {
  it("accepts bigint or decimal-string sizes from PostgREST", () => {
    expect(declaredByteSize(428450)).toBe(428450);
    expect(declaredByteSize("428450")).toBe(428450);
    expect(declaredByteSize("428450.0")).toBeNull();
    expect(byteSizeMatches(428450, "428450")).toBe(true);
    expect(byteSizeMatches(5, 6)).toBe(false);
  });

  it("does not reject authorized bytes when Storage omits a real MIME type", () => {
    expect(mediaTypeMatches("", "image/webp")).toBe(true);
    expect(mediaTypeMatches("application/octet-stream", "image/webp")).toBe(
      true,
    );
    expect(mediaTypeMatches("image/webp; charset=utf-8", "image/webp")).toBe(
      true,
    );
    expect(mediaTypeMatches("IMAGE/WEBP", "image/webp")).toBe(true);
    expect(mediaTypeMatches("image/png", "image/webp")).toBe(false);
    expect(mediaTypeMatches("video/quicktime", "video/quicktime")).toBe(true);
    expect(mediaTypeMatches("video/mp4", "video/quicktime")).toBe(true);
    expect(mediaTypeMatches("video/quicktime", "video/mp4")).toBe(true);
    expect(mediaTypeMatches("image/jpg", "image/jpeg")).toBe(true);
  });

  it("compares SHA-256 hex after stripping PostgREST prefixes and case", () => {
    const digest =
      "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0";
    expect(sha256HexMatches(digest, digest.toUpperCase())).toBe(true);
    expect(sha256HexMatches(digest, `\\x${digest}`)).toBe(true);
    expect(sha256HexMatches(digest, `  ${digest}  `)).toBe(true);
    expect(sha256HexMatches(digest, "0".repeat(64))).toBe(false);
    expect(sha256HexMatches(digest, undefined)).toBe(false);
  });

  it("treats a missing Content-Length as unknown rather than zero bytes", () => {
    expect(
      contentLengthAgrees(new Headers({ "content-type": "video/mp4" }), 10),
    ).toBe(true);
    expect(
      contentLengthAgrees(new Headers({ "content-length": "10" }), 10),
    ).toBe(true);
    expect(
      contentLengthAgrees(new Headers({ "content-length": "9" }), 10),
    ).toBe(false);
  });

  it("fetches descriptor-bound bytes through a short-lived signed URL", async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed" },
      error: null,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "content-type": "image/webp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const object = await fetchSignedPrivateObject(
      { createSignedUrl },
      "display/private/photo.webp",
    );

    expect(createSignedUrl).toHaveBeenCalledWith(
      "display/private/photo.webp",
      60,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.test/signed",
      { cache: "no-store", redirect: "error" },
    );
    expect(object?.contentType).toBe("image/webp");
    expect(new Uint8Array(object?.bytes ?? [])).toEqual(
      new Uint8Array([9, 8, 7]),
    );
    vi.unstubAllGlobals();
  });

  it("returns null when Storage refuses to sign or the signed fetch is empty", async () => {
    expect(
      await fetchSignedPrivateObject(
        {
          createSignedUrl: async () => ({
            data: null,
            error: { message: "denied" },
          }),
        },
        "display/private/photo.webp",
      ),
    ).toBeNull();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await fetchSignedPrivateObject(
        {
          createSignedUrl: async () => ({
            data: { signedUrl: "https://storage.example.test/signed" },
            error: null,
          }),
        },
        "display/private/photo.webp",
      ),
    ).toBeNull();
    vi.unstubAllGlobals();
  });

  it("streams a matching object before the last chunk is released and stops a bad digest", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest =
      "74f81fe167d99b4cb41d6d0ccda82278caee9f3e2f25d5e5a3936ff3dcec60d0";
    const good = streamVerifiedBytes(
      new Response(bytes).body!,
      bytes.byteLength,
      digest,
    );
    expect(new Uint8Array(await new Response(good).arrayBuffer())).toEqual(
      bytes,
    );
    const bad = streamVerifiedBytes(
      new Response(bytes).body!,
      bytes.byteLength,
      "0".repeat(64),
    );
    await expect(new Response(bad).arrayBuffer()).rejects.toThrow(
      /did not match its descriptor/u,
    );
  });

  it("mints one signed-url batch per bucket and reuses it", async () => {
    clearSignedPrivateUrls();
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        {
          path: "display/one",
          signedUrl: "https://storage.example.test/one",
          error: null,
        },
        {
          path: "display/two",
          signedUrl: "https://storage.example.test/two",
          error: null,
        },
      ],
      error: null,
    });
    await warmSignedPhotoUrls(
      { from: () => ({ createSignedUrl: vi.fn(), createSignedUrls }) },
      [
        { bucket_id: "our-days-display", object_path: "display/one" },
        { bucket_id: "our-days-display", object_path: "display/two" },
        { bucket_id: "our-days-display", object_path: "display/one" },
      ],
    );
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith(
      ["display/one", "display/two"],
      60,
    );
  });

  it("cache-busts a same-origin retry without dropping the photo id", () => {
    expect(privateMediaRetrySrc("/api/media/moments/one", 0)).toBe(
      "/api/media/moments/one",
    );
    expect(privateMediaRetrySrc("/api/media/moments/one", 1)).toBe(
      "/api/media/moments/one?retry=1",
    );
    expect(
      privateMediaRetrySrc(
        "/api/media/moments/one?photo=10000000-0000-4000-8000-000000000011",
        2,
      ),
    ).toBe(
      "/api/media/moments/one?photo=10000000-0000-4000-8000-000000000011&retry=2",
    );
  });
});
