import { describe, expect, it } from "vitest";
import {
  byteSizeMatches,
  declaredByteSize,
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
