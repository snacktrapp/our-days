import { createHash } from "node:crypto";
import { mkdtemp, readdir, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PHOTO_DISPLAY_TRANSFORM_VERSION,
  validatePhotoDisplayByteStream,
  withPhotoDisplayDerivative,
} from "../../scripts/lib/photo-display-derivative.mjs";
import { withValidatedPhotoSpool } from "../../scripts/lib/photo-byte-validator.mjs";

let tempDirectory: string;

type ByteSource = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

type ValidatedPhotoEvidence = {
  channels: number;
  height: number;
  mimeType: string;
  pages: number;
  sha256Hex: string;
  sizeBytes: number;
  stream: ByteSource;
  width: number;
};

type DisplayDerivative = {
  channels: number;
  height: number;
  mimeType: string;
  pages: number;
  sha256Hex: string;
  sizeBytes: number;
  stream: AsyncIterable<Uint8Array>;
  transformVersion: string;
  width: number;
};

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
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

function chunkedStream(bytes: Uint8Array, chunkSize: number) {
  return {
    async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.subarray(offset, offset + chunkSize);
      }
    },
  };
}

function webpChunkTypes(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  const types: string[] = [];
  let position = 12;
  while (position < bytes.length) {
    const type = bytes.subarray(position, position + 4).toString("ascii");
    const length = bytes.readUInt32LE(position + 4);
    types.push(type);
    position += 8 + length + (length % 2);
  }
  expect(position).toBe(bytes.length);
  return types;
}

function riffChunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    header,
    data,
    ...(data.length % 2 === 1 ? [Buffer.alloc(1)] : []),
  ]);
}

function insertWebpChunkAfterFirst(bytes: Buffer, type: string, data: Buffer) {
  const firstLength = bytes.readUInt32LE(16);
  const firstEnd = 20 + firstLength + (firstLength % 2);
  const inserted = riffChunk(type, data);
  const result = Buffer.concat([
    bytes.subarray(0, firstEnd),
    inserted,
    bytes.subarray(firstEnd),
  ]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

function validationOptions(bytes: Uint8Array, mimeType: string) {
  return {
    expectedMimeType: mimeType,
    expectedSha256Hex: sha256Hex(bytes),
    expectedSizeBytes: bytes.byteLength,
    tempDirectory,
  };
}

async function derive(bytes: Uint8Array, mimeType: string, options = {}) {
  return withValidatedPhotoSpool(
    byteStream(bytes),
    validationOptions(bytes, mimeType),
    (validated: ValidatedPhotoEvidence) =>
      withPhotoDisplayDerivative(
        validated,
        { tempDirectory, ...options },
        async (derivative: DisplayDerivative) => {
          const chunks: Buffer[] = [];
          for await (const chunk of derivative.stream) {
            chunks.push(Buffer.from(chunk));
          }
          return { ...derivative, bytes: Buffer.concat(chunks), stream: null };
        },
      ),
  );
}

async function trustedValidatedEvidence(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ValidatedPhotoEvidence> {
  const metadata = await sharp(bytes).metadata();
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height || !metadata.channels) {
    throw new Error("Synthetic validated evidence is incomplete");
  }
  return {
    channels: metadata.channels,
    height,
    mimeType,
    pages: metadata.pages ?? 1,
    sha256Hex: sha256Hex(bytes),
    sizeBytes: bytes.byteLength,
    stream: byteStream(bytes),
    width,
  };
}

async function deriveTrusted(evidence: ValidatedPhotoEvidence, options = {}) {
  return withPhotoDisplayDerivative(
    evidence,
    { tempDirectory, ...options },
    async (derivative: DisplayDerivative) => {
      const chunks: Buffer[] = [];
      for await (const chunk of derivative.stream) {
        chunks.push(Buffer.from(chunk));
      }
      return { ...derivative, bytes: Buffer.concat(chunks), stream: null };
    },
  );
}

function asymmetricRaw(width: number, height: number) {
  const colors = [
    [245, 20, 20],
    [20, 245, 20],
    [20, 20, 245],
    [245, 245, 20],
  ];
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const quadrant = (y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0);
      const offset = (y * width + x) * 3;
      raw.set(colors[quadrant], offset);
    }
  }
  return raw;
}

async function sampledCorners(bytes: Buffer) {
  const { data, info } = await sharp(bytes).raw().toBuffer({
    resolveWithObject: true,
  });
  const pixel = (x: number, y: number) => {
    const offset = (y * info.width + x) * info.channels;
    return [...data.subarray(offset, offset + 3)];
  };
  return [
    pixel(Math.floor(info.width / 4), Math.floor(info.height / 4)),
    pixel(Math.floor((info.width * 3) / 4), Math.floor(info.height / 4)),
    pixel(Math.floor(info.width / 4), Math.floor((info.height * 3) / 4)),
    pixel(Math.floor((info.width * 3) / 4), Math.floor((info.height * 3) / 4)),
  ];
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({
    code,
    name: "PhotoDisplayDerivativeError",
  });
}

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "photo-derivative-test-"));
});

afterEach(async () => {
  expect(await readdir(tempDirectory)).toEqual([]);
  await rmdir(tempDirectory);
});

describe("photo display derivative", () => {
  it("auto-orients and strips EXIF, GPS, ICC, IPTC, and XMP metadata", async () => {
    const source = await sharp({
      create: {
        background: "#a24f38",
        channels: 3,
        height: 40,
        width: 80,
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Artist: "Synthetic family fixture" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "W" },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="synthetic-gps-canary" /></rdf:RDF></x:xmpmeta>',
      )
      .toBuffer();
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.exif?.includes("Synthetic family fixture")).toBe(
      true,
    );
    expect(sourceMetadata.xmp?.includes("synthetic-gps-canary")).toBe(true);
    expect(sourceMetadata.icc).toBeDefined();

    const derivative = await derive(source, "image/jpeg");
    expect(derivative).toMatchObject({
      channels: 3,
      height: 80,
      mimeType: "image/webp",
      pages: 1,
      transformVersion: PHOTO_DISPLAY_TRANSFORM_VERSION,
      width: 40,
    });
    expect(derivative.sha256Hex).toBe(sha256Hex(derivative.bytes));
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata).toMatchObject({ format: "webp", height: 80, width: 40 });
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(webpChunkTypes(derivative.bytes)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^VP8[ XL]$/u)]),
    );
    expect(webpChunkTypes(derivative.bytes)).not.toEqual(
      expect.arrayContaining(["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"]),
    );
  });

  it.each([
    [1, [0, 1, 2, 3]],
    [2, [1, 0, 3, 2]],
    [3, [3, 2, 1, 0]],
    [4, [2, 3, 0, 1]],
    [5, [0, 2, 1, 3]],
    [6, [2, 0, 3, 1]],
    [7, [3, 1, 2, 0]],
    [8, [1, 3, 0, 2]],
  ] as const)(
    "applies asymmetric EXIF orientation %i before encoding",
    async (orientation, expectedOrder) => {
      const colors = [
        [245, 20, 20],
        [20, 245, 20],
        [20, 20, 245],
        [245, 245, 20],
      ];
      const source = await sharp(asymmetricRaw(80, 60), {
        raw: { channels: 3, height: 60, width: 80 },
      })
        .jpeg({ quality: 95 })
        .withMetadata({ orientation })
        .toBuffer();
      const derivative = await derive(source, "image/jpeg");
      expect([derivative.width, derivative.height]).toEqual(
        orientation <= 4 ? [80, 60] : [60, 80],
      );
      const corners = await sampledCorners(derivative.bytes);
      for (let index = 0; index < corners.length; index += 1) {
        const expected = colors[expectedOrder[index]];
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(corners[index][channel] - expected[channel]),
          ).toBeLessThan(35);
        }
      }
    },
  );

  it.each([
    ["image/jpeg", "jpeg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ] as const)(
    "transcodes a synthetic %s source to the fixed profile",
    async (mimeType, format) => {
      const builder = sharp({
        create: {
          background: { alpha: 0.65, b: 180, g: 80, r: 30 },
          channels: 4,
          height: 60,
          width: 100,
        },
      });
      const source = await builder[format]().toBuffer();
      const derivative = await derive(source, mimeType);
      expect(derivative.mimeType).toBe("image/webp");
      expect(derivative.width).toBe(100);
      expect(derivative.height).toBe(60);
      expect(derivative.sizeBytes).toBe(derivative.bytes.byteLength);
      expect(derivative.sha256Hex).toBe(sha256Hex(derivative.bytes));
    },
  );

  it("bounds both dimensions without enlarging a smaller image", async () => {
    const large = await sharp({
      create: {
        background: "#284f68",
        channels: 3,
        height: 600,
        width: 1200,
      },
    })
      .png()
      .toBuffer();
    const reduced = await derive(large, "image/png", { maxEdge: 300 });
    expect(reduced.width).toBe(300);
    expect(reduced.height).toBe(150);

    const small = await sharp({
      create: {
        background: "#8a6947",
        channels: 3,
        height: 20,
        width: 30,
      },
    })
      .jpeg()
      .toBuffer();
    const unchanged = await derive(small, "image/jpeg", { maxEdge: 300 });
    expect(unchanged.width).toBe(30);
    expect(unchanged.height).toBe(20);
  });

  it("preserves alpha while stripping every metadata container", async () => {
    const width = 64;
    const height = 32;
    const raw = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        raw.set([40, 120, 210, Math.round((x / (width - 1)) * 255)], offset);
      }
    }
    const source = await sharp(raw, {
      raw: { channels: 4, height, width },
    })
      .png()
      .toBuffer();
    const derivative = await derive(source, "image/png");
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.channels).toBe(4);
    const { data, info } = await sharp(derivative.bytes).raw().toBuffer({
      resolveWithObject: true,
    });
    expect(data[3]).toBeLessThan(20);
    expect(data[(info.width - 1) * info.channels + 3]).toBeGreaterThan(235);
  });

  it("converts a CMYK JPEG into the fixed sRGB display profile", async () => {
    const source = await sharp({
      create: {
        background: "#81532b",
        channels: 3,
        height: 24,
        width: 36,
      },
    })
      .toColourspace("cmyk")
      .jpeg()
      .toBuffer();
    expect((await sharp(source).metadata()).space).toBe("cmyk");

    const derivative = await derive(source, "image/jpeg");
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.space).toBe("srgb");
    expect(metadata.icc).toBeUndefined();
  });

  it("is repeatable across different validated-stream chunk boundaries", async () => {
    const source = await sharp(asymmetricRaw(120, 90), {
      raw: { channels: 3, height: 90, width: 120 },
    })
      .jpeg({ progressive: true, quality: 91 })
      .toBuffer();
    const firstEvidence = await trustedValidatedEvidence(source, "image/jpeg");
    firstEvidence.stream = chunkedStream(source, 7);
    const secondEvidence = await trustedValidatedEvidence(source, "image/jpeg");
    secondEvidence.stream = chunkedStream(source, 64 * 1024);
    const first = await deriveTrusted(firstEvidence);
    const second = await deriveTrusted(secondEvidence);
    expect(first.sha256Hex).toBe(second.sha256Hex);
    expect(first.bytes).toEqual(second.bytes);
  });

  it("uses a private output directory and exposes no pathname", async () => {
    const source = await sharp({
      create: {
        background: "#4d6e53",
        channels: 3,
        height: 40,
        width: 60,
      },
    })
      .png()
      .toBuffer();
    let directoryMode: number | undefined;

    await withValidatedPhotoSpool(
      byteStream(source),
      validationOptions(source, "image/png"),
      (validated: ValidatedPhotoEvidence) =>
        withPhotoDisplayDerivative(
          validated,
          { tempDirectory },
          async (derivative: DisplayDerivative) => {
            expect(derivative).not.toHaveProperty("path");
            const childDirectories = await readdir(tempDirectory);
            const derivativeDirectory = childDirectories.find((name) =>
              name.startsWith("our-days-photo-derivative-"),
            );
            expect(derivativeDirectory).toBeDefined();
            const childPath = join(tempDirectory, derivativeDirectory!);
            directoryMode = (await stat(childPath)).mode & 0o777;
            expect(await readdir(childPath)).toEqual([]);
            for await (const chunk of derivative.stream) {
              expect(chunk.byteLength).toBeGreaterThan(0);
              // Complete consumption is the worker boundary.
            }
          },
        ),
    );

    expect(directoryMode).toBe(0o700);
  });

  it("rejects output that exceeds the configured byte cap", async () => {
    const raw = Buffer.alloc(256 * 256 * 3);
    for (let index = 0; index < raw.length; index += 1)
      raw[index] = index % 251;
    const source = await sharp(raw, {
      raw: { channels: 3, height: 256, width: 256 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();

    await expectCode(
      withPhotoDisplayDerivative(
        await trustedValidatedEvidence(source, "image/png"),
        { maxOutputBytes: 32, tempDirectory },
        async ({ stream }: DisplayDerivative) => {
          for await (const chunk of stream) {
            expect(chunk.byteLength).toBeGreaterThan(0);
            // The callback must never be reached for an oversized output.
          }
        },
      ),
      "PHOTO_DERIVATIVE_BYTE_LIMIT_EXCEEDED",
    );
  });

  it("requires complete trusted-callback consumption", async () => {
    const source = await sharp({
      create: {
        background: "#735c8f",
        channels: 3,
        height: 80,
        width: 120,
      },
    })
      .jpeg()
      .toBuffer();

    await expectCode(
      withPhotoDisplayDerivative(
        await trustedValidatedEvidence(source, "image/jpeg"),
        { tempDirectory },
        async () => "incorrect-success",
      ),
      "PHOTO_DERIVATIVE_STREAM_INCOMPLETE",
    );
  });

  it("rejects forged validation evidence before reading a stream", async () => {
    let read = false;
    async function* source() {
      read = true;
      yield new Uint8Array([1]);
    }
    await expectCode(
      withPhotoDisplayDerivative(
        {
          channels: 3,
          height: 1,
          mimeType: "image/heic",
          pages: 1,
          sha256Hex: "0".repeat(64),
          sizeBytes: 1,
          stream: source(),
          width: 1,
        },
        { tempDirectory },
        async () => {},
      ),
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
    );
    expect(read).toBe(false);
  });

  it("recounts and rehashes the exact source before reporting success", async () => {
    const source = await sharp({
      create: {
        background: "#745c38",
        channels: 3,
        height: 12,
        width: 16,
      },
    })
      .jpeg()
      .toBuffer();
    const evidence = await trustedValidatedEvidence(source, "image/jpeg");
    evidence.sha256Hex = "0".repeat(64);
    await expectCode(
      deriveTrusted(evidence),
      "PHOTO_DERIVATIVE_SOURCE_MISMATCH",
    );
  });

  it("independently revalidates canonical bytes and rejects extra RIFF chunks", async () => {
    const source = await sharp({
      create: {
        background: { alpha: 0.7, b: 170, g: 95, r: 45 },
        channels: 4,
        height: 18,
        width: 26,
      },
    })
      .png()
      .toBuffer();
    const derivative = await derive(source, "image/png");
    const canonicalOptions = {
      expectedChannels: derivative.channels,
      expectedHeight: derivative.height,
      expectedPages: derivative.pages,
      expectedSha256Hex: derivative.sha256Hex,
      expectedSizeBytes: derivative.sizeBytes,
      expectedWidth: derivative.width,
      tempDirectory,
      transformVersion: derivative.transformVersion,
    };
    await expect(
      validatePhotoDisplayByteStream(
        chunkedStream(derivative.bytes, 5),
        canonicalOptions,
      ),
    ).resolves.toMatchObject({
      mimeType: "image/webp",
      sha256Hex: derivative.sha256Hex,
      transformVersion: PHOTO_DISPLAY_TRANSFORM_VERSION,
    });

    const tampered = insertWebpChunkAfterFirst(
      derivative.bytes,
      "JUNK",
      Buffer.from("not-allowed"),
    );
    await expectCode(
      validatePhotoDisplayByteStream(chunkedStream(tampered, 11), {
        ...canonicalOptions,
        expectedSha256Hex: sha256Hex(tampered),
        expectedSizeBytes: tampered.length,
      }),
      "PHOTO_DERIVATIVE_CANONICAL_MISMATCH",
    );
  });

  it("times out a stalled source and never invokes the callback", async () => {
    let returned = false;
    const stalled = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<never>(() => {}),
          async return() {
            returned = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    };
    await expectCode(
      withPhotoDisplayDerivative(
        {
          channels: 3,
          height: 1,
          mimeType: "image/jpeg",
          pages: 1,
          sha256Hex: "0".repeat(64),
          sizeBytes: 1,
          stream: stalled,
          width: 1,
        },
        { tempDirectory, transformTimeoutSeconds: 1 },
        async () => {
          throw new Error("callback must not run");
        },
      ),
      "PHOTO_DERIVATIVE_TIMEOUT",
    );
    expect(returned).toBe(true);
  });
});
