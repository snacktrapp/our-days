import { createHash } from "node:crypto";
import { mkdtemp, readdir, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
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

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

function twoFrameApng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const frameControl = (sequence: number) => {
    const bytes = Buffer.alloc(26);
    bytes.writeUInt32BE(sequence, 0);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(1, 8);
    bytes.writeUInt16BE(1, 20);
    bytes.writeUInt16BE(10, 22);
    return bytes;
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", Buffer.concat([u32(2), u32(0)])),
    pngChunk("fcTL", frameControl(0)),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    pngChunk("fcTL", frameControl(1)),
    pngChunk(
      "fdAT",
      Buffer.concat([u32(2), deflateSync(Buffer.from([0, 0, 0, 255, 255]))]),
    ),
    pngChunk("IEND"),
  ]);
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

  it("accepts a JPEG with a recognized HDR gain map", async () => {
    const builder = sharp({
      create: {
        background: "#f4c36b",
        channels: 3,
        height: 64,
        width: 96,
      },
    }) as ReturnType<typeof sharp> & {
      withGainMap(): ReturnType<typeof sharp>;
    };
    const bytes = await builder.withGainMap().jpeg({ quality: 90 }).toBuffer();
    const metadata = await sharp(bytes).metadata();

    expect(metadata.gainMap?.image).toBeInstanceOf(Buffer);
    await expect(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/jpeg"),
      ),
    ).resolves.toMatchObject({
      height: 64,
      mimeType: "image/jpeg",
      pages: 1,
      width: 96,
    });
  });

  it("accepts a JPEG with a smaller MPF-style preview stream", async () => {
    const primary = await sharp({
      create: {
        background: "#1a6b8a",
        channels: 3,
        height: 64,
        width: 96,
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const preview = await sharp({
      create: {
        background: "#112233",
        channels: 3,
        height: 16,
        width: 24,
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
    const bytes = Buffer.concat([primary, preview]);

    await expect(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/jpeg"),
      ),
    ).resolves.toMatchObject({
      height: 64,
      mimeType: "image/jpeg",
      pages: 1,
      width: 96,
    });
  });

  it("still rejects a second JPEG that is large enough to be another photo", async () => {
    const primary = await sharp({
      create: {
        background: "#526f82",
        channels: 3,
        height: 40,
        width: 48,
      },
    })
      .jpeg()
      .toBuffer();
    const other = await sharp({
      create: {
        background: "#814d52",
        channels: 3,
        height: 36,
        width: 40,
      },
    })
      .jpeg()
      .toBuffer();
    const bytes = Buffer.concat([primary, other]);

    await expectCode(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/jpeg"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );
  });

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
    let observedDirectoryMode: number | undefined;

    async function* inspectedChunks() {
      yield bytes.subarray(0, 16);
      const childEntries = await readdir(tempDirectory);
      expect(childEntries).toHaveLength(1);
      const childDirectory = join(tempDirectory, childEntries[0]);
      const childStat = await stat(childDirectory);
      expect(childStat.isDirectory()).toBe(true);
      observedDirectoryMode = childStat.mode & 0o777;
      const entries = await readdir(childDirectory);
      expect(entries).toHaveLength(1);
      observedMode =
        (await stat(join(childDirectory, entries[0]))).mode & 0o777;
      yield bytes.subarray(16);
    }

    await validatePhotoByteStream(
      inspectedChunks(),
      validationOptions(bytes, "image/jpeg"),
    );
    expect(observedDirectoryMode).toBe(0o700);
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
        const childEntries = await readdir(tempDirectory);
        expect(childEntries).toHaveLength(1);
        expect(await readdir(join(tempDirectory, childEntries[0]))).toEqual([]);
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

  it("does not report callback success unless every lent byte is consumed", async () => {
    const bytes = await sharp({
      create: {
        background: "#414f61",
        channels: 3,
        height: 4,
        width: 6,
      },
    })
      .png()
      .toBuffer();

    await expectCode(
      withValidatedPhotoSpool(
        byteStream(bytes),
        validationOptions(bytes, "image/png"),
        async () => "incorrect-success",
      ),
      "PHOTO_VALIDATED_STREAM_INCOMPLETE",
    );
  });

  it("rejects a callback that consumes only the first handoff chunk", async () => {
    const raw = Buffer.alloc(300 * 300 * 3);
    for (let index = 0; index < raw.length; index += 1) {
      raw[index] = index % 251;
    }
    const bytes = await sharp(raw, {
      raw: { channels: 3, height: 300, width: 300 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(bytes.byteLength).toBeGreaterThan(64 * 1024);

    await expectCode(
      withValidatedPhotoSpool(
        byteStream(bytes),
        validationOptions(bytes, "image/png"),
        async ({ stream }: ValidatedPhotoSpool) => {
          const iterator = stream[Symbol.asyncIterator]();
          const first = await iterator.next();
          expect(first.done).toBe(false);
          await iterator.return?.();
          return "incorrect-partial-success";
        },
      ),
      "PHOTO_VALIDATED_STREAM_INCOMPLETE",
    );
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

  it("rejects a valid two-frame APNG before Sharp can flatten it", async () => {
    const bytes = twoFrameApng();
    const metadata = await sharp(bytes, {
      animated: false,
      pages: 1,
    }).metadata();
    expect(metadata.pages).toBeUndefined();

    await expectCode(
      validatePhotoByteStream(
        byteStream(bytes),
        validationOptions(bytes, "image/png"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );
  });

  it("rejects a PNG with a bad chunk CRC or unknown critical chunk", async () => {
    const valid = await sharp({
      create: {
        background: "#536c7d",
        channels: 3,
        height: 2,
        width: 2,
      },
    })
      .png()
      .toBuffer();
    const badCrc = Buffer.from(valid);
    badCrc[29] ^= 0xff;
    await expectCode(
      validatePhotoByteStream(
        byteStream(badCrc),
        validationOptions(badCrc, "image/png"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );

    const nonAsciiAlias = Buffer.from(valid);
    nonAsciiAlias.set([0xc9, 0xc8, 0xc4, 0xd2], 12);
    nonAsciiAlias.writeUInt32BE(crc32(nonAsciiAlias.subarray(12, 29)), 29);
    await expectCode(
      validatePhotoByteStream(
        byteStream(nonAsciiAlias),
        validationOptions(nonAsciiAlias, "image/png"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );

    const unknownCritical = Buffer.concat([
      valid.subarray(0, 33),
      pngChunk("ABCD"),
      valid.subarray(33),
    ]);
    await expectCode(
      validatePhotoByteStream(
        byteStream(unknownCritical),
        validationOptions(unknownCritical, "image/png"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );
  });

  it("rejects high-bit WebP FourCC aliases and animated WebP", async () => {
    const still = await sharp({
      create: {
        background: "#724d81",
        channels: 3,
        height: 2,
        width: 2,
      },
    })
      .webp()
      .toBuffer();
    const aliased = Buffer.from(still);
    aliased.set([0xd2, 0xc9, 0xc6, 0xc6], 0);
    await expectCode(
      validatePhotoByteStream(
        byteStream(aliased),
        validationOptions(aliased, "image/webp"),
      ),
      "PHOTO_FORMAT_UNSUPPORTED",
    );

    const rawFrames = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
    const animated = await sharp(rawFrames, {
      raw: { channels: 4, height: 2, pageHeight: 1, width: 1 },
    })
      .webp({ delay: [100, 100], loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expectCode(
      validatePhotoByteStream(
        byteStream(animated),
        validationOptions(animated, "image/webp"),
      ),
      "PHOTO_PAGE_LIMIT_EXCEEDED",
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
      "PHOTO_FORMAT_UNSUPPORTED",
    );
  });

  it.each(["trailing payload", "concatenated image"] as const)(
    "rejects a JPEG with a %s outside its first codestream",
    async (variant) => {
      const jpeg = await sharp({
        create: {
          background: "#526f82",
          channels: 3,
          height: 3,
          width: 4,
        },
      })
        .jpeg({ progressive: true })
        .toBuffer();
      const bytes =
        variant === "trailing payload"
          ? Buffer.concat([
              jpeg,
              Buffer.from("PK\u0003\u0004hidden-trailer"),
              Buffer.from([0xff, 0xd9]),
            ])
          : Buffer.concat([jpeg, jpeg]);

      await expectCode(
        validatePhotoByteStream(
          byteStream(bytes),
          validationOptions(bytes, "image/jpeg"),
        ),
        "PHOTO_FORMAT_UNSUPPORTED",
      );
    },
  );

  it("times out a stalled web stream, cancels it, and removes its spool", async () => {
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull() {
        return new Promise(() => {});
      },
    });

    await expectCode(
      validatePhotoByteStream(stalled, {
        expectedMimeType: "image/jpeg",
        expectedSha256Hex: "0".repeat(64),
        expectedSizeBytes: 1,
        inputTimeoutMilliseconds: 40,
        tempDirectory,
      }),
      "PHOTO_INPUT_TIMEOUT",
    );
    expect(cancelled).toBe(true);
  });

  it("times out infinite zero-length chunks without starving its deadline", async () => {
    let returned = false;
    const zeroChunks = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { done: false as const, value: new Uint8Array() };
          },
          async return() {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };

    await expectCode(
      validatePhotoByteStream(zeroChunks, {
        expectedMimeType: "image/jpeg",
        expectedSha256Hex: "0".repeat(64),
        expectedSizeBytes: 1,
        inputTimeoutMilliseconds: 40,
        tempDirectory,
      }),
      "PHOTO_INPUT_TIMEOUT",
    );
    expect(returned).toBe(true);
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
