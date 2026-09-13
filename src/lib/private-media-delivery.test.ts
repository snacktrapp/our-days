import { describe, expect, it, vi } from "vitest";
import {
  byteSizeMatches,
  declaredByteSize,
  fetchSignedPrivateObject,
  mediaTypeMatches,
  privateMediaRetrySrc,
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
