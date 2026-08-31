import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdtemp, open, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { withValidatedPhotoSpool } from "./photo-byte-validator.mjs";

export const PHOTO_DISPLAY_TRANSFORM_VERSION = "photo-display-webp-v1";
export const DEFAULT_PHOTO_DISPLAY_MAX_EDGE = 2560;
export const MAX_PHOTO_DISPLAY_BYTES = 12 * 1024 * 1024;

const MAX_SOURCE_PIXELS = 50_000_000;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_EDGE_LIMIT = 4096;
const MAX_TRANSFORM_SECONDS = 60;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const supportedSourceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const allowedWebpChunkTypes = new Set(["VP8X", "ALPH", "VP8 ", "VP8L"]);

export class PhotoDisplayDerivativeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PhotoDisplayDerivativeError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PhotoDisplayDerivativeError(code, message);
}

function positiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail("PHOTO_DERIVATIVE_CONFIGURATION_INVALID", `${name} is invalid.`);
  }
  return value;
}

function validateInput(validated, rawOptions, callback) {
  if (!validated || typeof validated !== "object") {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "Validated photo evidence is required.",
    );
  }
  if (
    !validated.stream ||
    typeof validated.stream[Symbol.asyncIterator] !== "function" ||
    !supportedSourceMimeTypes.has(validated.mimeType) ||
    !sha256Pattern.test(validated.sha256Hex) ||
    !Number.isSafeInteger(validated.sizeBytes) ||
    validated.sizeBytes < 1 ||
    validated.sizeBytes > MAX_SOURCE_BYTES ||
    !Number.isSafeInteger(validated.width) ||
    validated.width < 1 ||
    !Number.isSafeInteger(validated.height) ||
    validated.height < 1 ||
    validated.width * validated.height > MAX_SOURCE_PIXELS ||
    !Number.isSafeInteger(validated.channels) ||
    validated.channels < 1 ||
    validated.channels > 4 ||
    validated.pages !== 1
  ) {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "Validated photo evidence is invalid.",
    );
  }
  if (typeof callback !== "function") {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "A trusted derivative callback is required.",
    );
  }

  const options = rawOptions ?? {};
  if (!options || typeof options !== "object") {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "Derivative options are invalid.",
    );
  }
  if (
    options.tempDirectory !== undefined &&
    (typeof options.tempDirectory !== "string" ||
      options.tempDirectory.length === 0)
  ) {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "The temporary directory is invalid.",
    );
  }

  return {
    maxEdge: positiveInteger(
      options.maxEdge ?? DEFAULT_PHOTO_DISPLAY_MAX_EDGE,
      "maxEdge",
      MAX_EDGE_LIMIT,
    ),
    maxOutputBytes: positiveInteger(
      options.maxOutputBytes ?? MAX_PHOTO_DISPLAY_BYTES,
      "maxOutputBytes",
      MAX_PHOTO_DISPLAY_BYTES,
    ),
    tempDirectory: options.tempDirectory,
    transformTimeoutSeconds: positiveInteger(
      options.transformTimeoutSeconds ?? 20,
      "transformTimeoutSeconds",
      MAX_TRANSFORM_SECONDS,
    ),
  };
}

function sameDigest(actual, expected) {
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
        "PHOTO_DERIVATIVE_TEMP_WRITE_FAILED",
        "Display bytes could not be stored safely.",
      );
    }
    offset += bytesWritten;
  }
}

async function verifyOutput(path, limits) {
  let metadata;
  try {
    metadata = await sharp(path, {
      animated: false,
      failOn: "warning",
      limitInputChannels: 4,
      limitInputPixels: limits.maxEdge * limits.maxEdge,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .timeout({ seconds: limits.transformTimeoutSeconds })
      .metadata();
  } catch {
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes could not be verified safely.",
    );
  }

  const pages = metadata.pages ?? 1;
  if (
    metadata.format !== "webp" ||
    !Number.isSafeInteger(metadata.width) ||
    metadata.width < 1 ||
    metadata.width > limits.maxEdge ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height < 1 ||
    metadata.height > limits.maxEdge ||
    !Number.isSafeInteger(metadata.channels) ||
    metadata.channels < 1 ||
    metadata.channels > 4 ||
    pages !== 1 ||
    metadata.orientation !== undefined ||
    metadata.exif !== undefined ||
    metadata.icc !== undefined ||
    metadata.iptc !== undefined ||
    metadata.xmp !== undefined
  ) {
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes violate the safe derivative profile.",
    );
  }

  try {
    const decoder = sharp(path, {
      animated: false,
      failOn: "warning",
      limitInputChannels: 4,
      limitInputPixels: limits.maxEdge * limits.maxEdge,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .raw({ depth: "uchar" })
      .timeout({ seconds: limits.transformTimeoutSeconds });
    const decodedByteLimit = limits.maxEdge * limits.maxEdge * 4;
    let decodedBytes = 0;
    for await (const chunk of decoder) {
      decodedBytes += chunk.length;
      if (decodedBytes > decodedByteLimit) {
        decoder.destroy();
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Decoded display bytes exceed the safe output limit.",
        );
      }
    }
    if (decodedBytes < 1) {
      fail(
        "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
        "Display bytes could not be decoded safely.",
      );
    }
  } catch (error) {
    if (error instanceof PhotoDisplayDerivativeError) throw error;
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes could not be decoded safely.",
    );
  }

  return {
    channels: metadata.channels,
    height: metadata.height,
    pages,
    width: metadata.width,
  };
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
    if (bytesRead < 1) {
      fail(
        "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
        "Display bytes have an invalid WebP structure.",
      );
    }
    offset += bytesRead;
  }
  return buffer;
}

async function verifyExactWebpChunks(readAt, sizeBytes, expectedImage) {
  if (sizeBytes < 20) {
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes have an invalid WebP structure.",
    );
  }
  const header = await readAt(12, 0);
  if (
    !header.subarray(0, 4).equals(Buffer.from("RIFF", "ascii")) ||
    !header.subarray(8, 12).equals(Buffer.from("WEBP", "ascii")) ||
    header.readUInt32LE(4) + 8 !== sizeBytes
  ) {
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes have an invalid WebP structure.",
    );
  }

  let position = 12;
  let primaryChunks = 0;
  let sawAlpha = false;
  let sawExtendedHeader = false;
  let extendedHeaderClaimsAlpha = false;
  while (position < sizeBytes) {
    if (sizeBytes - position < 8) {
      fail(
        "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
        "Display bytes have an invalid WebP structure.",
      );
    }
    const chunkHeader = await readAt(8, position);
    const type = chunkHeader.subarray(0, 4).toString("latin1");
    const dataLength = chunkHeader.readUInt32LE(4);
    const paddedLength = dataLength + (dataLength % 2);
    const chunkEnd = position + 8 + paddedLength;
    if (
      !allowedWebpChunkTypes.has(type) ||
      !Number.isSafeInteger(chunkEnd) ||
      chunkEnd > sizeBytes
    ) {
      fail(
        "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
        "Display bytes violate the safe WebP chunk profile.",
      );
    }
    if (type === "VP8X") {
      if (sawExtendedHeader || position !== 12 || dataLength !== 10) {
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Display bytes violate the safe WebP chunk profile.",
        );
      }
      const extendedHeader = await readAt(10, position + 8);
      const flags = extendedHeader[0];
      const canvasWidth =
        extendedHeader[4] |
        (extendedHeader[5] << 8) |
        (extendedHeader[6] << 16);
      const canvasHeight =
        extendedHeader[7] |
        (extendedHeader[8] << 8) |
        (extendedHeader[9] << 16);
      if (
        (flags & 0xef) !== 0 ||
        extendedHeader[1] !== 0 ||
        extendedHeader[2] !== 0 ||
        extendedHeader[3] !== 0 ||
        canvasWidth + 1 !== expectedImage.width ||
        canvasHeight + 1 !== expectedImage.height
      ) {
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Display bytes contain forbidden WebP features or metadata.",
        );
      }
      extendedHeaderClaimsAlpha = (flags & 0x10) !== 0;
      sawExtendedHeader = true;
    }
    if (type === "ALPH") {
      if (!sawExtendedHeader || sawAlpha || primaryChunks > 0) {
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Display bytes violate the safe WebP chunk profile.",
        );
      }
      sawAlpha = true;
    }
    if (type === "VP8 " || type === "VP8L") {
      primaryChunks += 1;
      if (primaryChunks > 1 || (sawAlpha && type !== "VP8 ")) {
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Display bytes violate the safe WebP chunk profile.",
        );
      }
    }
    if (dataLength % 2 === 1) {
      const padding = await readAt(1, position + 8 + dataLength);
      if (padding[0] !== 0) {
        fail(
          "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
          "Display bytes have invalid WebP padding.",
        );
      }
    }
    position = chunkEnd;
  }
  if (
    position !== sizeBytes ||
    primaryChunks !== 1 ||
    (sawExtendedHeader && extendedHeaderClaimsAlpha !== sawAlpha)
  ) {
    fail(
      "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
      "Display bytes have an incomplete WebP structure.",
    );
  }
}

function readableOutput(handle, sizeBytes) {
  const state = { bytesRead: 0, hash: createHash("sha256") };
  const stream = Readable.from(
    (async function* readDerivativeBytes() {
      const chunkSize = 64 * 1024;
      let position = 0;
      while (position < sizeBytes) {
        const buffer = Buffer.allocUnsafe(
          Math.min(chunkSize, sizeBytes - position),
        );
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        if (bytesRead < 1) {
          fail(
            "PHOTO_DERIVATIVE_SPOOL_INTEGRITY_FAILED",
            "Display bytes changed during handoff.",
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

async function verifySpool(handle, sizeBytes, expectedSha256) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < sizeBytes) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, sizeBytes - position),
      position,
    );
    if (bytesRead < 1) {
      fail(
        "PHOTO_DERIVATIVE_SPOOL_INTEGRITY_FAILED",
        "Display bytes changed before handoff.",
      );
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  const { bytesRead } = await handle.read(trailing, 0, 1, position);
  if (bytesRead !== 0 || !sameDigest(hash.digest(), expectedSha256)) {
    fail(
      "PHOTO_DERIVATIVE_SPOOL_INTEGRITY_FAILED",
      "Display bytes changed before handoff.",
    );
  }
}

/**
 * Produces one bounded, orientation-correct, metadata-free WebP derivative
 * from a pathless stream already validated by withValidatedPhotoSpool. The
 * output is lent only to trusted worker code and must be consumed completely.
 */
export async function withPhotoDisplayDerivative(
  validated,
  rawOptions,
  callback,
) {
  const options = validateInput(validated, rawOptions, callback);
  let directory;
  let writeHandle;
  let readHandle;
  let outputPath;
  let derivativeStream;
  let callbackResult;
  let failure;
  let cleanupFailed = false;
  let writeIdentity;

  try {
    directory = await mkdtemp(
      join(options.tempDirectory ?? tmpdir(), "our-days-photo-derivative-"),
    );
    outputPath = join(directory, `display-${randomUUID()}.webp`);
    writeHandle = await open(outputPath, "wx", 0o600);

    const input = Readable.from(validated.stream);
    const sourceHash = createHash("sha256");
    let sourceSizeBytes = 0;
    const sourceGuard = new Transform({
      transform(chunk, _encoding, done) {
        const bytes = Buffer.from(chunk);
        if (sourceSizeBytes + bytes.length > validated.sizeBytes) {
          done(
            new PhotoDisplayDerivativeError(
              "PHOTO_DERIVATIVE_SOURCE_MISMATCH",
              "Derivative source bytes do not match the validated original.",
            ),
          );
          return;
        }
        sourceSizeBytes += bytes.length;
        sourceHash.update(bytes);
        done(null, bytes);
      },
      flush(done) {
        const expectedHash = Buffer.from(validated.sha256Hex, "hex");
        const actualHash = sourceHash.digest();
        if (
          sourceSizeBytes !== validated.sizeBytes ||
          !sameDigest(actualHash, expectedHash)
        ) {
          done(
            new PhotoDisplayDerivativeError(
              "PHOTO_DERIVATIVE_SOURCE_MISMATCH",
              "Derivative source bytes do not match the validated original.",
            ),
          );
          return;
        }
        done();
      },
    });
    const transformer = sharp({
      animated: false,
      failOn: "warning",
      limitInputChannels: 4,
      limitInputPixels: MAX_SOURCE_PIXELS,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .autoOrient()
      .resize({
        fit: "inside",
        height: options.maxEdge,
        kernel: "lanczos3",
        width: options.maxEdge,
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .webp({
        alphaQuality: 90,
        effort: 4,
        quality: 82,
        smartSubsample: true,
      })
      .timeout({ seconds: options.transformTimeoutSeconds });

    const hash = createHash("sha256");
    let sizeBytes = 0;
    const sink = new Writable({
      write(chunk, _encoding, done) {
        const bytes = Buffer.from(chunk);
        if (sizeBytes + bytes.length > options.maxOutputBytes) {
          done(
            new PhotoDisplayDerivativeError(
              "PHOTO_DERIVATIVE_BYTE_LIMIT_EXCEEDED",
              "Display bytes exceed the safe output limit.",
            ),
          );
          return;
        }
        sizeBytes += bytes.length;
        hash.update(bytes);
        writeAll(writeHandle, bytes).then(() => done(), done);
      },
    });

    let timedOut = false;
    const timeoutError = new PhotoDisplayDerivativeError(
      "PHOTO_DERIVATIVE_TIMEOUT",
      "Display transformation exceeded the safe time limit.",
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      input.destroy(timeoutError);
      sourceGuard.destroy(timeoutError);
      transformer.destroy(timeoutError);
      sink.destroy(timeoutError);
    }, options.transformTimeoutSeconds * 1000);
    try {
      await pipeline(input, sourceGuard, transformer, sink);
    } catch (error) {
      if (timedOut) throw timeoutError;
      if (error instanceof PhotoDisplayDerivativeError) throw error;
      fail(
        "PHOTO_DERIVATIVE_TRANSFORM_FAILED",
        "Photo display transformation failed safely.",
      );
    } finally {
      clearTimeout(timeout);
    }
    if (sizeBytes < 1) {
      fail(
        "PHOTO_DERIVATIVE_TRANSFORM_FAILED",
        "Photo display transformation produced no bytes.",
      );
    }

    const sha256 = hash.digest();
    await writeHandle.sync();
    writeIdentity = await writeHandle.stat();
    await writeHandle.close();
    writeHandle = undefined;

    const output = await verifyOutput(outputPath, options);
    readHandle = await open(outputPath, "r");
    const identity = await readHandle.stat();
    if (
      identity.dev !== writeIdentity.dev ||
      identity.ino !== writeIdentity.ino ||
      identity.size !== sizeBytes ||
      (identity.mode & 0o777) !== 0o600
    ) {
      fail(
        "PHOTO_DERIVATIVE_SPOOL_INTEGRITY_FAILED",
        "Display storage changed before handoff.",
      );
    }
    await verifySpool(readHandle, sizeBytes, sha256);
    await verifyExactWebpChunks(
      (length, position) => readExactAt(readHandle, length, position),
      sizeBytes,
      output,
    );
    if (output.width > validated.width || output.height > validated.height) {
      fail(
        "PHOTO_DERIVATIVE_VERIFICATION_FAILED",
        "Display dimensions exceed the validated source geometry.",
      );
    }
    await unlink(outputPath);
    outputPath = undefined;

    const handoff = readableOutput(readHandle, sizeBytes);
    derivativeStream = handoff.stream;
    const result = Object.freeze({
      ...output,
      mimeType: "image/webp",
      sha256Hex: sha256.toString("hex"),
      sizeBytes,
      stream: derivativeStream,
      transformVersion: PHOTO_DISPLAY_TRANSFORM_VERSION,
    });
    try {
      callbackResult = await callback(result);
    } catch {
      fail(
        "PHOTO_DERIVATIVE_CALLBACK_FAILED",
        "Display derivative handoff did not complete.",
      );
    }
    if (handoff.state.bytesRead !== sizeBytes) {
      fail(
        "PHOTO_DERIVATIVE_STREAM_INCOMPLETE",
        "Display derivative bytes were not consumed completely.",
      );
    }
    if (!sameDigest(handoff.state.hash.digest(), sha256)) {
      fail(
        "PHOTO_DERIVATIVE_SPOOL_INTEGRITY_FAILED",
        "Display bytes changed during handoff.",
      );
    }
  } catch (error) {
    failure =
      error instanceof PhotoDisplayDerivativeError
        ? error
        : new PhotoDisplayDerivativeError(
            "PHOTO_DERIVATIVE_FAILED",
            "Photo display derivative could not be produced safely.",
          );
  } finally {
    if (derivativeStream) derivativeStream.destroy();
    if (readHandle) {
      try {
        await readHandle.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (writeHandle) {
      try {
        await writeHandle.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (outputPath) {
      try {
        await unlink(outputPath);
      } catch (error) {
        if (error?.code !== "ENOENT") cleanupFailed = true;
      }
    }
    if (directory) {
      try {
        if ((await readdir(directory)).length > 0) cleanupFailed = true;
        await rmdir(directory);
      } catch (error) {
        if (error?.code !== "ENOENT") cleanupFailed = true;
      }
    }
  }

  if (cleanupFailed) {
    throw new PhotoDisplayDerivativeError(
      "PHOTO_DERIVATIVE_TEMP_CLEANUP_FAILED",
      "Temporary display data could not be removed safely.",
    );
  }
  if (failure) throw failure;
  return callbackResult;
}

function validateCanonicalOptions(rawOptions) {
  if (!rawOptions || typeof rawOptions !== "object") {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "Canonical display evidence is required.",
    );
  }
  const expectedSizeBytes = positiveInteger(
    rawOptions.expectedSizeBytes,
    "expectedSizeBytes",
    MAX_PHOTO_DISPLAY_BYTES,
  );
  const expectedWidth = positiveInteger(
    rawOptions.expectedWidth,
    "expectedWidth",
    MAX_EDGE_LIMIT,
  );
  const expectedHeight = positiveInteger(
    rawOptions.expectedHeight,
    "expectedHeight",
    MAX_EDGE_LIMIT,
  );
  const expectedChannels = positiveInteger(
    rawOptions.expectedChannels,
    "expectedChannels",
    4,
  );
  if (
    typeof rawOptions.expectedSha256Hex !== "string" ||
    !sha256Pattern.test(rawOptions.expectedSha256Hex) ||
    rawOptions.expectedPages !== 1 ||
    rawOptions.transformVersion !== PHOTO_DISPLAY_TRANSFORM_VERSION ||
    (rawOptions.tempDirectory !== undefined &&
      (typeof rawOptions.tempDirectory !== "string" ||
        rawOptions.tempDirectory.length === 0))
  ) {
    fail(
      "PHOTO_DERIVATIVE_CONFIGURATION_INVALID",
      "Canonical display evidence is invalid.",
    );
  }
  return {
    expectedChannels,
    expectedHeight,
    expectedPages: 1,
    expectedSha256Hex: rawOptions.expectedSha256Hex,
    expectedSizeBytes,
    expectedWidth,
    tempDirectory: rawOptions.tempDirectory,
    transformVersion: rawOptions.transformVersion,
  };
}

/**
 * Independently revalidates canonical display bytes after Storage upload.
 * This deliberately re-counts, re-hashes, parses, and fully decodes the
 * downloaded object before a database coordinator may publish its ledger row.
 */
export async function validatePhotoDisplayByteStream(source, rawOptions) {
  const options = validateCanonicalOptions(rawOptions);
  let derivativeFailure;
  try {
    return await withValidatedPhotoSpool(
      source,
      {
        expectedMimeType: "image/webp",
        expectedSha256Hex: options.expectedSha256Hex,
        expectedSizeBytes: options.expectedSizeBytes,
        maxBytes: MAX_PHOTO_DISPLAY_BYTES,
        maxChannels: 4,
        maxPages: 1,
        maxPixels: MAX_EDGE_LIMIT * MAX_EDGE_LIMIT,
        tempDirectory: options.tempDirectory,
      },
      async (validated) => {
        try {
          if (
            validated.width !== options.expectedWidth ||
            validated.height !== options.expectedHeight ||
            validated.channels !== options.expectedChannels ||
            validated.pages !== options.expectedPages
          ) {
            fail(
              "PHOTO_DERIVATIVE_CANONICAL_MISMATCH",
              "Canonical display geometry does not match its claim.",
            );
          }
          const chunks = [];
          for await (const chunk of validated.stream) {
            chunks.push(Buffer.from(chunk));
          }
          const bytes = Buffer.concat(chunks, validated.sizeBytes);
          const metadata = await sharp(bytes, {
            animated: false,
            failOn: "warning",
            limitInputChannels: 4,
            limitInputPixels: MAX_EDGE_LIMIT * MAX_EDGE_LIMIT,
            pages: 1,
            sequentialRead: true,
            unlimited: false,
          }).metadata();
          if (
            metadata.orientation !== undefined ||
            metadata.exif !== undefined ||
            metadata.icc !== undefined ||
            metadata.iptc !== undefined ||
            metadata.xmp !== undefined
          ) {
            fail(
              "PHOTO_DERIVATIVE_CANONICAL_MISMATCH",
              "Canonical display bytes retain forbidden metadata.",
            );
          }
          await verifyExactWebpChunks(
            async (length, position) => {
              if (position < 0 || position + length > bytes.length) {
                fail(
                  "PHOTO_DERIVATIVE_CANONICAL_MISMATCH",
                  "Canonical display bytes have an invalid structure.",
                );
              }
              return bytes.subarray(position, position + length);
            },
            bytes.length,
            validated,
          );
          return Object.freeze({
            channels: validated.channels,
            height: validated.height,
            mimeType: validated.mimeType,
            pages: validated.pages,
            sha256Hex: validated.sha256Hex,
            sizeBytes: validated.sizeBytes,
            transformVersion: options.transformVersion,
            width: validated.width,
          });
        } catch (error) {
          derivativeFailure = new PhotoDisplayDerivativeError(
            "PHOTO_DERIVATIVE_CANONICAL_MISMATCH",
            "Canonical display bytes could not be verified safely.",
          );
          throw error;
        }
      },
    );
  } catch (error) {
    if (derivativeFailure) throw derivativeFailure;
    throw error;
  }
}
