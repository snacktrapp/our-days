import { createHash } from "node:crypto";
import { mkdtemp, readdir, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  validatePhotoByteStream,
  withValidatedPhotoSpool,
} from "../../scripts/lib/photo-byte-validator.mjs";

let tempDirectory: string;

type ValidatedPhotoSpool = {
  channels: number;
  height: number;
  mimeType: string;
  pages: number;
  sha256Hex: string;
  sizeBytes: number;
  stream: AsyncIterable<Uint8Array>;
  width: number;
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validationOptions(
  bytes: Uint8Array,
  expectedMimeType: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    expectedMimeType,
    expectedSha256Hex: sha256Hex(bytes),
    expectedSizeBytes: bytes.byteLength,
    tempDirectory,
    ...overrides,
  };
}

function byteStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const midpoint = Math.max(1, Math.floor(bytes.byteLength / 2));
      controller.enqueue(bytes.subarray(0, midpoint));
      controller.enqueue(bytes.subarray(midpoint));
      controller.close();
    },
  });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({
    code,
    name: "PhotoByteValidationError",
  });
}

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "photo-validator-test-"));
});

afterEach(async () => {
  expect(await readdir(tempDirectory)).toEqual([]);
  await rmdir(tempDirectory);
});

describe("photo byte validator", () => {
  it.each([
    ["image/jpeg", "jpeg", 3],
    ["image/png", "png", 4],
    ["image/webp", "webp", 3],
  ] as const)(
    "fully decodes a synthetic %s stream with exact identity",
    async (mimeType, format, channels) => {
      const builder = sharp({
        create: {
          background: { alpha: 1, b: 43, g: 108, r: 177 },
          channels: 4,
          height: 5,
          width: 7,
        },
      });
      const bytes = await builder[format]().toBuffer();

      const result = await validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, mimeType),
      );

      expect(result).toEqual({
        channels,
        height: 5,
        mimeType,
        pages: 1,
        sha256Hex: sha256Hex(bytes),
        sizeBytes: bytes.byteLength,
        width: 7,
      });
    },
  );

  it("opens its spool exclusively with owner-only permissions", async () => {
    const bytes = await sharp({
      create: {
        background: { b: 5, g: 10, r: 20 },
        channels: 3,
        height: 3,
        width: 4,
      },
    })
      .jpeg()
      .toBuffer();
    let observedMode: number | undefined;

    async function* inspectedChunks() {
      yield bytes.subarray(0, 16);
      const entries = await readdir(tempDirectory);
      expect(entries).toHaveLength(1);
      observedMode = (await stat(join(tempDirectory, entries[0]))).mode & 0o777;
      yield bytes.subarray(16);
    }

    await validatePhotoByteStream(
      inspectedChunks(),
      validationOptions(bytes, "image/jpeg"),
    );
    expect(observedMode).toBe(0o600);
  });

  it("lends exact bytes without exposing a replaceable path", async () => {
    const bytes = await sharp({
      create: {
        background: "#6b8990",
        channels: 3,
        height: 4,
        width: 6,
      },
    })
      .png()
      .toBuffer();

    const callbackValue = await withValidatedPhotoSpool(
      byteStream(bytes),
      validationOptions(bytes, "image/png"),
      async (validated: ValidatedPhotoSpool) => {
        expect(validated).not.toHaveProperty("path");
        expect(validated.stream).not.toHaveProperty("path");
        expect(await readdir(tempDirectory)).toEqual([]);
        const received: Buffer[] = [];
        for await (const chunk of validated.stream) {
          received.push(Buffer.from(chunk));
        }
        expect(Buffer.concat(received)).toEqual(bytes);
        return "promoted";
      },
    );

    expect(callbackValue).toBe("promoted");
  });

  it("destroys exact bytes when the trusted callback fails", async () => {
    const bytes = await sharp({
      create: {
        background: "#b06f51",
        channels: 3,
        height: 4,
        width: 6,
      },
    })
      .webp()
      .toBuffer();

    await expectCode(
      withValidatedPhotoSpool(
        byteStream(bytes),
        validationOptions(bytes, "image/webp"),
        async ({ stream }: ValidatedPhotoSpool) => {
          for await (const chunk of stream) {
            expect(chunk.byteLength).toBeGreaterThan(0);
            break;
          }
          throw new Error("synthetic promotion failure");
        },
      ),
      "PHOTO_VALIDATED_CALLBACK_FAILED",
    );
  });

  it.each([
    ["size", { expectedSizeBytes: 1 }, "PHOTO_SIZE_MISMATCH"],
    ["hash", { expectedSha256Hex: "0".repeat(64) }, "PHOTO_HASH_MISMATCH"],
    ["MIME", { expectedMimeType: "image/png" }, "PHOTO_MIME_MISMATCH"],
  ] as const)(
    "rejects an exact %s mismatch",
    async (_label, override, code) => {
      const bytes = await sharp({
        create: {
          background: "#8a4938",
          channels: 3,
          height: 2,
          width: 2,
        },
      })
        .jpeg()
        .toBuffer();

      await expectCode(
        validatePhotoByteStream(
          byteStream(bytes),
          validationOptions(bytes, "image/jpeg", override),
        ),
        code,
      );
    },
  );

  it("rejects HEIC until a pinned decoder boundary exists", async () => {
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    await expectCode(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/heic"),
      ),
      "PHOTO_MIME_UNSUPPORTED",
    );
  });

  it("rejects unsupported magic and a structurally truncated image", async () => {
    const unsupported = new TextEncoder().encode("not an image");
    await expectCode(
      validatePhotoByteStream(
        byteStream(unsupported),
        validationOptions(unsupported, "image/jpeg"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );

    const jpeg = await sharp({
      create: {
        background: "#304b57",
        channels: 3,
        height: 3,
        width: 3,
      },
    })
      .jpeg()
      .toBuffer();
    const truncated = jpeg.subarray(0, jpeg.length - 2);
    await expectCode(
      validatePhotoByteStream(
        byteStream(truncated),
        validationOptions(truncated, "image/jpeg"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );
  });

  it("stops an oversized async iterable before writing past the bound", async () => {
    const bytes = new Uint8Array(9).fill(0x61);
    async function* chunks() {
      yield bytes.subarray(0, 4);
      yield bytes.subarray(4);
    }

    await expectCode(
      validatePhotoByteStream(
        chunks(),
        validationOptions(bytes.subarray(0, 8), "image/jpeg", {
          maxBytes: 8,
        }),
      ),
      "PHOTO_BYTE_LIMIT_EXCEEDED",
    );
  });

  it("rejects a valid image whose dimensions exceed the pixel cap", async () => {
    const bytes = await sharp({
      create: {
        background: "#d5a15b",
        channels: 3,
        height: 10,
        width: 11,
      },
    })
      .png()
      .toBuffer();

    await expectCode(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/png", { maxPixels: 100 }),
      ),
      "PHOTO_PIXEL_LIMIT_EXCEEDED",
    );
  });

  it("requires a successful full decode after conservative JPEG magic", async () => {
    const corrupt = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff,
      0xd9,
    ]);

    await expectCode(
      validatePhotoByteStream(
        byteStream(corrupt),
        validationOptions(corrupt, "image/jpeg"),
      ),
      "PHOTO_DECODE_FAILED",
    );
  });

  it("removes the spool when its source fails", async () => {
    async function* failingSource() {
      yield new Uint8Array([0xff, 0xd8, 0xff]);
      throw new Error("synthetic source failure");
    }

    await expectCode(
      validatePhotoByteStream(failingSource(), {
        expectedMimeType: "image/jpeg",
        expectedSha256Hex: "0".repeat(64),
        expectedSizeBytes: 4,
        tempDirectory,
      }),
      "PHOTO_VALIDATION_FAILED",
    );
  });
});
