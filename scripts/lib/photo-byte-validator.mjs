import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, open, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";

export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_PHOTO_PIXELS = 50_000_000;
const MAX_GAIN_MAP_PIXELS = 12_500_000;

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
const pngCriticalChunkTypes = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const pngAnimationChunkTypes = new Set(["acTL", "fcTL", "fdAT"]);
const sha256Pattern = /^[0-9a-f]{64}$/u;
const DEFAULT_INPUT_TIMEOUT_MILLISECONDS = 30_000;
const MAX_INPUT_TIMEOUT_MILLISECONDS = 120_000;

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
  const inputTimeoutMilliseconds = positiveInteger(
    options.inputTimeoutMilliseconds ?? DEFAULT_INPUT_TIMEOUT_MILLISECONDS,
    "inputTimeoutMilliseconds",
    MAX_INPUT_TIMEOUT_MILLISECONDS,
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
    inputTimeoutMilliseconds,
    maxBytes,
    maxChannels,
    maxPages,
    maxPixels,
    tempDirectory: options.tempDirectory,
  };
}

function inputTimedOut() {
  return new PhotoByteValidationError(
    "PHOTO_INPUT_TIMEOUT",
    "Photo input did not complete within the safe time limit.",
  );
}

async function settleBeforeDeadline(operation, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw inputTimedOut();
  const promise = operation();

  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(inputTimedOut()), remaining);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function cancelWithoutWaiting(cancel) {
  try {
    Promise.resolve(cancel()).catch(() => {});
  } catch {
    // Cancellation is best-effort; validation cleanup remains authoritative.
  }
}

async function* streamChunks(source, deadline) {
  if (source && typeof source.getReader === "function") {
    const reader = source.getReader();
    let complete = false;
    try {
      while (true) {
        const { done, value } = await settleBeforeDeadline(
          () => reader.read(),
          deadline,
        );
        if (done) {
          complete = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!complete) {
        cancelWithoutWaiting(() => reader.cancel());
      }
      try {
        reader.releaseLock();
      } catch {
        // A timed-out pending read can retain the lock until cancellation.
      }
    }
    return;
  }

  if (source && typeof source[Symbol.asyncIterator] === "function") {
    const iterator = source[Symbol.asyncIterator]();
    let complete = false;
    try {
      while (true) {
        const { done, value } = await settleBeforeDeadline(
          () => iterator.next(),
          deadline,
        );
        if (done) {
          complete = true;
          return;
        }
        yield value;
      }
    } finally {
      if (!complete && typeof iterator.return === "function") {
        cancelWithoutWaiting(() => iterator.return());
      }
    }
    return;
  }

  fail("PHOTO_STREAM_INVALID", "Photo input must be a readable byte stream.");
}

function jpegStructureFailure() {
  fail(
    "PHOTO_FORMAT_UNSUPPORTED",
    "Photo bytes do not have a supported image structure.",
  );
}

const pngCrcTable = new Uint32Array(256);
for (let index = 0; index < pngCrcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  pngCrcTable[index] = value >>> 0;
}

function updatePngCrc(crc, bytes) {
  let value = crc;
  for (const byte of bytes) {
    value = pngCrcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

function pngStructureFailure() {
  fail(
    "PHOTO_FORMAT_UNSUPPORTED",
    "Photo bytes do not have a supported image structure.",
  );
}

async function readExactAt(handle, length, position) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead < 1) pngStructureFailure();
    offset += bytesRead;
  }
  return buffer;
}

async function validateExactPngDatastream(handle, sizeBytes) {
  if (sizeBytes < pngSignature.length + pngFooter.length) {
    pngStructureFailure();
  }
  const signature = await readExactAt(handle, pngSignature.length, 0);
  if (!signature.equals(pngSignature)) pngStructureFailure();

  let position = pngSignature.length;
  let chunkIndex = 0;
  let sawIdat = false;
  let idatEnded = false;
  let sawPalette = false;
  let complete = false;

  while (position < sizeBytes) {
    if (sizeBytes - position < 12) pngStructureFailure();
    const header = await readExactAt(handle, 8, position);
    const dataLength = header.readUInt32BE(0);
    const typeBytes = header.subarray(4, 8);
    const type = typeBytes.toString("latin1");
    if (
      ![...typeBytes].every(
        (byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122),
      ) ||
      typeBytes[2] < 65 ||
      typeBytes[2] > 90
    ) {
      pngStructureFailure();
    }

    const chunkEnd = position + 12 + dataLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > sizeBytes) {
      pngStructureFailure();
    }
    if (pngAnimationChunkTypes.has(type)) pngStructureFailure();
    if (
      type.charCodeAt(0) >= 65 &&
      type.charCodeAt(0) <= 90 &&
      !pngCriticalChunkTypes.has(type)
    ) {
      pngStructureFailure();
    }
    if ((chunkIndex === 0) !== (type === "IHDR")) pngStructureFailure();
    if (type === "IHDR" && dataLength !== 13) pngStructureFailure();
    if (type === "PLTE") {
      if (sawPalette || sawIdat || dataLength < 3 || dataLength % 3 !== 0) {
        pngStructureFailure();
      }
      sawPalette = true;
    }
    if (type === "IDAT") {
      if (idatEnded) pngStructureFailure();
      sawIdat = true;
    } else if (sawIdat) {
      idatEnded = true;
    }
    if (type === "IEND") {
      if (!sawIdat || dataLength !== 0 || chunkEnd !== sizeBytes) {
        pngStructureFailure();
      }
      complete = true;
    }

    let crc = updatePngCrc(0xffffffff, typeBytes);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let dataPosition = position + 8;
    let remaining = dataLength;
    while (remaining > 0) {
      const length = Math.min(buffer.length, remaining);
      const { bytesRead } = await handle.read(buffer, 0, length, dataPosition);
      if (bytesRead < 1) pngStructureFailure();
      crc = updatePngCrc(crc, buffer.subarray(0, bytesRead));
      dataPosition += bytesRead;
      remaining -= bytesRead;
    }
    const expectedCrc = (
      await readExactAt(handle, 4, position + 8 + dataLength)
    ).readUInt32BE(0);
    if ((crc ^ 0xffffffff) >>> 0 !== expectedCrc) {
      pngStructureFailure();
    }

    position = chunkEnd;
    chunkIndex += 1;
    if (complete) return;
  }
  pngStructureFailure();
}

async function validateExactJpegCodestream(
  handle,
  sizeBytes,
  { allowAuxiliaryCodestream = false } = {},
) {
  let phase = "soi-first";
  let position = 0;
  let segmentLengthHigh = 0;
  let segmentMarker = 0;
  let segmentRemaining = 0;
  let sawScan = false;
  let codestreamCount = 0;
  let codestreamStart = 0;
  const codestreams = [];

  const finishSegment = () => {
    if (segmentMarker === 0xda) {
      sawScan = true;
      phase = "entropy";
    } else if (segmentMarker === 0xdc && sawScan) {
      // DNL is the only length-bearing marker that resumes the same scan.
      phase = "entropy";
    } else {
      phase = "marker-prefix";
    }
  };

  const acceptMarker = (marker) => {
    if (marker === 0xd9) {
      if (!sawScan) jpegStructureFailure();
      codestreamCount += 1;
      codestreams.push(
        Object.freeze({ end: position, start: codestreamStart }),
      );
      if (position === sizeBytes) {
        phase = "complete";
        return;
      }
      // Modern iPhone JPEGs can carry one HDR gain-map image as a second,
      // complete JPEG codestream. The caller separately requires Sharp to
      // recognise the MPF/gain-map relationship before accepting two streams.
      if (!allowAuxiliaryCodestream || codestreamCount !== 1) {
        jpegStructureFailure();
      }
      sawScan = false;
      codestreamStart = position;
      phase = "soi-first";
      return;
    }
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      jpegStructureFailure();
    }
    segmentMarker = marker;
    phase = "length-high";
  };

  const input = handle.createReadStream({
    autoClose: false,
    end: sizeBytes - 1,
    highWaterMark: 64 * 1024,
    start: 0,
  });
  for await (const suppliedChunk of input) {
    const chunk = Buffer.from(suppliedChunk);
    let index = 0;
    while (index < chunk.length) {
      if (phase === "segment") {
        const consumed = Math.min(segmentRemaining, chunk.length - index);
        index += consumed;
        position += consumed;
        segmentRemaining -= consumed;
        if (segmentRemaining === 0) finishSegment();
        continue;
      }
      if (phase === "entropy") {
        const markerIndex = chunk.indexOf(0xff, index);
        if (markerIndex === -1) {
          position += chunk.length - index;
          index = chunk.length;
        } else {
          position += markerIndex - index + 1;
          index = markerIndex + 1;
          phase = "entropy-marker";
        }
        continue;
      }

      const value = chunk[index];
      index += 1;
      position += 1;
      if (phase === "soi-first") {
        if (value !== 0xff) jpegStructureFailure();
        phase = "soi-second";
      } else if (phase === "soi-second") {
        if (value !== 0xd8) jpegStructureFailure();
        phase = "marker-prefix";
      } else if (phase === "marker-prefix") {
        if (value !== 0xff) jpegStructureFailure();
        phase = "marker";
      } else if (phase === "marker") {
        if (value === 0xff) continue;
        if (value === 0x00) jpegStructureFailure();
        acceptMarker(value);
      } else if (phase === "entropy-marker") {
        if (value === 0xff) continue;
        if (value === 0x00 || (value >= 0xd0 && value <= 0xd7)) {
          phase = "entropy";
        } else {
          acceptMarker(value);
        }
      } else if (phase === "length-high") {
        segmentLengthHigh = value;
        phase = "length-low";
      } else if (phase === "length-low") {
        const segmentLength = (segmentLengthHigh << 8) | value;
        if (segmentLength < 2) jpegStructureFailure();
        segmentRemaining = segmentLength - 2;
        if (segmentRemaining === 0) finishSegment();
        else phase = "segment";
      } else {
        jpegStructureFailure();
      }
    }
  }

  if (position !== sizeBytes || phase !== "complete") jpegStructureFailure();
  return Object.freeze(codestreams);
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
    prefix.subarray(0, 4).equals(Buffer.from("RIFF", "ascii")) &&
    prefix.subarray(8, 12).equals(Buffer.from("WEBP", "ascii")) &&
    ["VP8 ", "VP8L", "VP8X"].some((type) =>
      prefix.subarray(12, 16).equals(Buffer.from(type, "ascii")),
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

async function decodeCompletely(input, mimeType, limits) {
  let metadata;
  try {
    metadata = await sharp(input, {
      animated: false,
      failOn: "warning",
      limitInputChannels: limits.maxChannels,
      // Header inspection does not decode pixels. The dimensions are checked
      // below before the second, strictly bounded full-decode pipeline.
      limitInputPixels: false,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .timeout({ seconds: limits.decodeTimeoutSeconds })
      .metadata();
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
    const decoder = sharp(input, {
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

  return {
    channels,
    gainMapImage:
      mimeType === "image/jpeg" &&
      Buffer.isBuffer(metadata.gainMap?.image) &&
      metadata.gainMap.image.length > 0
        ? metadata.gainMap.image
        : null,
    height,
    pages,
    width,
  };
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
  const state = { bytesRead: 0, hash: createHash("sha256") };
  const stream = Readable.from(
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
        const chunk = buffer.subarray(0, bytesRead);
        state.bytesRead += bytesRead;
        state.hash.update(chunk);
        yield chunk;
      }
    })(),
  );
  return { state, stream };
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
    const tempBase = directory ?? tmpdir();
    directory = await mkdtemp(join(tempBase, "our-days-photo-validator-"));
    ownedDirectory = true;
    path = join(directory, `spool-${randomUUID()}`);
    handle = await open(path, "wx", 0o600);

    const hash = createHash("sha256");
    let prefix = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let sizeBytes = 0;

    const inputDeadline = Date.now() + options.inputTimeoutMilliseconds;
    for await (const suppliedChunk of streamChunks(source, inputDeadline)) {
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
    let jpegCodestreams = Object.freeze([
      Object.freeze({ end: sizeBytes, start: 0 }),
    ]);
    if (detectedMimeType === "image/jpeg") {
      jpegCodestreams = await validateExactJpegCodestream(
        readHandle,
        sizeBytes,
        { allowAuxiliaryCodestream: true },
      );
    }
    if (detectedMimeType === "image/png") {
      await validateExactPngDatastream(readHandle, sizeBytes);
    }

    const decoded = await decodeCompletely(path, detectedMimeType, options);
    if (jpegCodestreams.length > 1) {
      const auxiliaryRange = jpegCodestreams[1];
      const auxiliaryBytes = await readExactAt(
        readHandle,
        auxiliaryRange.end - auxiliaryRange.start,
        auxiliaryRange.start,
      );
      if (
        !decoded.gainMapImage ||
        !decoded.gainMapImage.equals(auxiliaryBytes)
      ) {
        jpegStructureFailure();
      }
      const auxiliary = await decodeCompletely(auxiliaryBytes, "image/jpeg", {
        ...options,
        maxPixels: Math.min(
          MAX_GAIN_MAP_PIXELS,
          options.maxPixels,
          decoded.width * decoded.height,
        ),
      });
      if (
        auxiliary.gainMapImage ||
        auxiliary.width > decoded.width ||
        auxiliary.height > decoded.height
      ) {
        jpegStructureFailure();
      }
    } else if (decoded.gainMapImage) {
      jpegStructureFailure();
    }
    result = Object.freeze({
      channels: decoded.channels,
      height: decoded.height,
      mimeType: detectedMimeType,
      pages: decoded.pages,
      sha256Hex: sha256.toString("hex"),
      sizeBytes,
      width: decoded.width,
    });

    // The already-open descriptor retains the exact inode while removing the
    // only pathname before trusted callback code can run.
    await unlink(path);
    path = undefined;
    const handoff = readableSpool(readHandle, sizeBytes);
    verifiedStream = handoff.stream;
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
    if (handoff.state.bytesRead !== sizeBytes) {
      fail(
        "PHOTO_VALIDATED_STREAM_INCOMPLETE",
        "Validated photo bytes were not consumed completely.",
      );
    }
    if (!sameDigest(handoff.state.hash.digest(), sha256)) {
      fail(
        "PHOTO_SPOOL_INTEGRITY_FAILED",
        "Validated photo bytes changed during handoff.",
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
  return withValidatedPhotoSpool(source, rawOptions, async (validated) => {
    for await (const chunk of validated.stream) {
      // Metadata-only callers still consume the verified inode completely.
      void chunk;
    }
    return Object.freeze({
      channels: validated.channels,
      height: validated.height,
      mimeType: validated.mimeType,
      pages: validated.pages,
      sha256Hex: validated.sha256Hex,
      sizeBytes: validated.sizeBytes,
      width: validated.width,
    });
  });
}
