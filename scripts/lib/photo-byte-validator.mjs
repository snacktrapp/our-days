import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, open, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_PHOTO_PIXELS = 50_000_000;

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const sharpFormatByMimeType = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const pngFooter = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const sha256Pattern = /^[0-9a-f]{64}$/u;

export class PhotoByteValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhotoByteValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhotoByteValidationError(code, message);
}

function positiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("PHOTO_VALIDATOR_CONFIGURATION_INVALID", `${name} is invalid.`);
  }
  return value;
}

function validateOptions(options) {
  if (!options || typeof options !== "object") {
    fail(
      "PHOTO_VALIDATOR_CONFIGURATION_INVALID",
      "Photo validation options are required.",
    );
  }

  const maxBytes = positiveInteger(
    options.maxBytes ?? MAX_PHOTO_BYTES,
    "maxBytes",
    MAX_PHOTO_BYTES,
  );
  const expectedSizeBytes = positiveInteger(
    options.expectedSizeBytes,
    "expectedSizeBytes",
    maxBytes,
  );
  const maxPixels = positiveInteger(
    options.maxPixels ?? DEFAULT_MAX_PHOTO_PIXELS,
    "maxPixels",
    DEFAULT_MAX_PHOTO_PIXELS,
  );
  const maxChannels = positiveInteger(
    options.maxChannels ?? 4,
    "maxChannels",
    4,
  );
  const maxPages = positiveInteger(options.maxPages ?? 1, "maxPages", 1);
  const decodeTimeoutSeconds = positiveInteger(
    options.decodeTimeoutSeconds ?? 15,
    "decodeTimeoutSeconds",
    60,
  );

  if (!allowedMimeTypes.has(options.expectedMimeType)) {
    fail(
      "PHOTO_MIME_UNSUPPORTED",
      "The claimed photo type is not supported by this validator.",
    );
  }
  if (
    typeof options.expectedSha256Hex !== "string" ||
    !sha256Pattern.test(options.expectedSha256Hex)
  ) {
    fail(
      "PHOTO_VALIDATOR_CONFIGURATION_INVALID",
      "The expected SHA-256 is invalid.",
    );
  }
  if (
    options.tempDirectory !== undefined &&
    (typeof options.tempDirectory !== "string" ||
      options.tempDirectory.length === 0)
  ) {
    fail(
      "PHOTO_VALIDATOR_CONFIGURATION_INVALID",
      "The temporary directory is invalid.",
    );
  }

  return {
    decodeTimeoutSeconds,
    expectedMimeType: options.expectedMimeType,
    expectedSha256: Buffer.from(options.expectedSha256Hex, "hex"),
    expectedSizeBytes,
    maxBytes,
    maxChannels,
    maxPages,
    maxPixels,
    tempDirectory: options.tempDirectory,
  };
}

async function* streamChunks(source) {
  if (source && typeof source.getReader === "function") {
    const reader = source.getReader();
    let complete = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          complete = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!complete) {
        try {
          await reader.cancel();
        } catch {
          // The validation failure remains authoritative.
        }
      }
      reader.releaseLock();
    }
    return;
  }

  if (source && typeof source[Symbol.asyncIterator] === "function") {
    for await (const chunk of source) yield chunk;
    return;
  }

  fail("PHOTO_STREAM_INVALID", "Photo input must be a readable byte stream.");
}

function byteChunk(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (
    !ArrayBuffer.isView(value) ||
    typeof value.BYTES_PER_ELEMENT !== "number" ||
    value.BYTES_PER_ELEMENT !== 1
  ) {
    fail("PHOTO_STREAM_INVALID", "Photo input contained a non-byte chunk.");
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function appendPrefix(prefix, chunk) {
  if (prefix.length >= 16 || chunk.length === 0) return prefix;
  return Buffer.concat([prefix, chunk]).subarray(0, 16);
}

function appendTail(tail, chunk) {
  if (chunk.length === 0) return tail;
  return Buffer.concat([tail, chunk]).subarray(-12);
}

function sniffMimeType(prefix, tail, sizeBytes) {
  if (
    prefix.length >= 3 &&
    prefix[0] === 0xff &&
    prefix[1] === 0xd8 &&
    prefix[2] === 0xff &&
    tail.length >= 2 &&
    tail.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
  ) {
    return "image/jpeg";
  }

  if (
    prefix.length >= pngSignature.length &&
    prefix.subarray(0, pngSignature.length).equals(pngSignature) &&
    tail.length === pngFooter.length &&
    tail.equals(pngFooter)
  ) {
    return "image/png";
  }

  if (
    prefix.length >= 16 &&
    prefix.subarray(0, 4).toString("ascii") === "RIFF" &&
    prefix.subarray(8, 12).toString("ascii") === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(
      prefix.subarray(12, 16).toString("ascii"),
    ) &&
    prefix.readUInt32LE(4) + 8 === sizeBytes
  ) {
    return "image/webp";
  }

  fail(
    "PHOTO_FORMAT_UNSUPPORTED",
    "Photo bytes do not have a supported image structure.",
  );
}

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.length - offset,
      null,
    );
    if (bytesWritten < 1) {
      fail(
        "PHOTO_TEMP_WRITE_FAILED",
        "Photo bytes could not be stored safely.",
      );
    }
    offset += bytesWritten;
  }
}

async function decodeCompletely(path, mimeType, limits) {
  let metadata;
  try {
    metadata = await sharp(path, {
      animated: false,
      failOn: "warning",
      limitInputChannels: limits.maxChannels,
      // Header inspection does not decode pixels. The dimensions are checked
      // below before the second, strictly bounded full-decode pipeline.
      limitInputPixels: false,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    }).metadata();
  } catch {
    fail("PHOTO_DECODE_FAILED", "Photo bytes could not be decoded safely.");
  }

  if (metadata.format !== sharpFormatByMimeType.get(mimeType)) {
    fail(
      "PHOTO_FORMAT_MISMATCH",
      "The decoded photo type does not match its byte signature.",
    );
  }

  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  const channels = metadata.channels;
  const pages = metadata.pages ?? 1;

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > limits.maxPixels
  ) {
    fail(
      "PHOTO_PIXEL_LIMIT_EXCEEDED",
      "Photo dimensions exceed the safe decode limit.",
    );
  }
  if (
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    channels > limits.maxChannels
  ) {
    fail(
      "PHOTO_CHANNEL_LIMIT_EXCEEDED",
      "Photo channels exceed the safe decode limit.",
    );
  }
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > limits.maxPages) {
    fail(
      "PHOTO_PAGE_LIMIT_EXCEEDED",
      "Multi-page or animated photos are not supported.",
    );
  }

  try {
    const decoder = sharp(path, {
      animated: false,
      failOn: "warning",
      limitInputChannels: limits.maxChannels,
      limitInputPixels: limits.maxPixels,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .autoOrient()
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .timeout({ seconds: limits.decodeTimeoutSeconds });

    let decodedBytes = 0;
    const decodedByteLimit = limits.maxPixels * limits.maxChannels;
    for await (const chunk of decoder) {
      decodedBytes += chunk.length;
      if (decodedBytes > decodedByteLimit) {
        decoder.destroy();
        fail(
          "PHOTO_DECODE_LIMIT_EXCEEDED",
          "Decoded photo data exceed the safe output limit.",
        );
      }
    }
    if (decodedBytes < 1) {
      fail("PHOTO_DECODE_FAILED", "Photo bytes could not be decoded safely.");
    }
  } catch (error) {
    if (error instanceof PhotoByteValidationError) throw error;
    fail("PHOTO_DECODE_FAILED", "Photo bytes could not be decoded safely.");
  }

  return { channels, height, pages, width };
}

function sameDigest(actual, expected) {
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function verifySpool(handle, expectedSizeBytes, expectedSha256) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;

  while (position < expectedSizeBytes) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, expectedSizeBytes - position),
      position,
    );
    if (bytesRead < 1) {
      fail(
        "PHOTO_SPOOL_INTEGRITY_FAILED",
        "Validated photo bytes changed before handoff.",
      );
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  const trailing = Buffer.allocUnsafe(1);
  const { bytesRead: trailingBytes } = await handle.read(
    trailing,
    0,
    1,
    position,
  );
  if (trailingBytes !== 0 || !sameDigest(hash.digest(), expectedSha256)) {
    fail(
      "PHOTO_SPOOL_INTEGRITY_FAILED",
      "Validated photo bytes changed before handoff.",
    );
  }
}

function readableSpool(handle, sizeBytes) {
  return Readable.from(
    (async function* readVerifiedBytes() {
      const bufferSize = 64 * 1024;
      let position = 0;
      while (position < sizeBytes) {
        const buffer = Buffer.allocUnsafe(
          Math.min(bufferSize, sizeBytes - position),
        );
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        if (bytesRead < 1) {
          fail(
            "PHOTO_SPOOL_INTEGRITY_FAILED",
            "Validated photo bytes changed during handoff.",
          );
        }
        position += bytesRead;
        yield buffer.subarray(0, bytesRead);
      }
    })(),
  );
}

/**
 * Validates one claimed photo, then lends a pathless, read-only stream of the
 * exact verified inode to a trusted worker callback. The callback must remain
 * worker-owned code: do not pass the stream or callback capability to users.
 * The backing pathname is unlinked before callback invocation and the stream
 * is destroyed when the callback settles, so neither may escape this scope.
 */
export async function withValidatedPhotoSpool(source, rawOptions, callback) {
  const options = validateOptions(rawOptions);
  if (typeof callback !== "function") {
    fail(
      "PHOTO_VALIDATOR_CONFIGURATION_INVALID",
      "A trusted validated-photo callback is required.",
    );
  }
  let ownedDirectory = false;
  let directory = options.tempDirectory;
  let handle;
  let readHandle;
  let verifiedStream;
  let path;
  let result;
  let callbackResult;
  let failure;
  let cleanupFailed = false;
  let spoolIdentity;

  try {
    if (!directory) {
      directory = await mkdtemp(join(tmpdir(), "our-days-photo-validator-"));
      ownedDirectory = true;
    }
    path = join(directory, `spool-${randomUUID()}`);
    handle = await open(path, "wx", 0o600);

    const hash = createHash("sha256");
    let prefix = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let sizeBytes = 0;

    for await (const suppliedChunk of streamChunks(source)) {
      const chunk = byteChunk(suppliedChunk);
      if (chunk.length === 0) continue;
      if (sizeBytes + chunk.length > options.maxBytes) {
        fail("PHOTO_BYTE_LIMIT_EXCEEDED", "Photo bytes exceed the safe limit.");
      }
      sizeBytes += chunk.length;
      hash.update(chunk);
      prefix = appendPrefix(prefix, chunk);
      tail = appendTail(tail, chunk);
      await writeAll(handle, chunk);
    }

    spoolIdentity = await handle.stat();
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (sizeBytes !== options.expectedSizeBytes) {
      fail("PHOTO_SIZE_MISMATCH", "Photo byte count does not match its claim.");
    }
    const sha256 = hash.digest();
    if (!sameDigest(sha256, options.expectedSha256)) {
      fail("PHOTO_HASH_MISMATCH", "Photo checksum does not match its claim.");
    }

    const detectedMimeType = sniffMimeType(prefix, tail, sizeBytes);
    if (detectedMimeType !== options.expectedMimeType) {
      fail("PHOTO_MIME_MISMATCH", "Photo type does not match its claim.");
    }

    const decoded = await decodeCompletely(path, detectedMimeType, options);
    result = Object.freeze({
      ...decoded,
      mimeType: detectedMimeType,
      sha256Hex: sha256.toString("hex"),
      sizeBytes,
    });

    readHandle = await open(path, "r");
    const handoffIdentity = await readHandle.stat();
    if (
      handoffIdentity.dev !== spoolIdentity.dev ||
      handoffIdentity.ino !== spoolIdentity.ino ||
      handoffIdentity.size !== sizeBytes ||
      (handoffIdentity.mode & 0o777) !== 0o600
    ) {
      fail(
        "PHOTO_SPOOL_INTEGRITY_FAILED",
        "Validated photo storage changed before handoff.",
      );
    }
    await verifySpool(readHandle, sizeBytes, sha256);

    // The already-open descriptor retains the exact inode while removing the
    // only pathname before trusted callback code can run.
    await unlink(path);
    path = undefined;
    verifiedStream = readableSpool(readHandle, sizeBytes);
    try {
      callbackResult = await callback(
        Object.freeze({ ...result, stream: verifiedStream }),
      );
    } catch {
      fail(
        "PHOTO_VALIDATED_CALLBACK_FAILED",
        "Validated photo handoff did not complete.",
      );
    }
  } catch (error) {
    failure =
      error instanceof PhotoByteValidationError
        ? error
        : new PhotoByteValidationError(
            "PHOTO_VALIDATION_FAILED",
            "Photo bytes could not be validated safely.",
          );
  } finally {
    if (verifiedStream) verifiedStream.destroy();
    if (readHandle) {
      try {
        await readHandle.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (handle) {
      try {
        await handle.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (path) {
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") cleanupFailed = true;
      }
    }
    if (ownedDirectory && directory) {
      try {
        const remaining = await readdir(directory);
        if (remaining.length > 0) cleanupFailed = true;
        await rmdir(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") cleanupFailed = true;
      }
    }
  }

  if (cleanupFailed) {
    throw new PhotoByteValidationError(
      "PHOTO_TEMP_CLEANUP_FAILED",
      "Temporary photo data could not be removed safely.",
    );
  }
  if (failure) throw failure;
  return callbackResult;
}

export async function validatePhotoByteStream(source, rawOptions) {
  return withValidatedPhotoSpool(source, rawOptions, (validated) =>
    Object.freeze({
      channels: validated.channels,
      height: validated.height,
      mimeType: validated.mimeType,
      pages: validated.pages,
      sha256Hex: validated.sha256Hex,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
    }),
  );
}
