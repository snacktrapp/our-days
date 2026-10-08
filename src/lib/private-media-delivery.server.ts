import "server-only";

import { createHash } from "node:crypto";
import {
  contentLengthAgrees,
  declaredByteSize,
  mediaTypeMatches,
  normalizedMediaType,
  normalizedSha256Hex,
  sha256HexMatches,
} from "./private-media-delivery";

type SignedUrlBucket = {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<{
    data: { signedUrl?: string | null } | null;
    error: unknown;
  }>;
};

type CachedVerifiedBytes = {
  key: string;
  bytes: Uint8Array;
  expiresAt: number;
};

const verifiedBytesCache: CachedVerifiedBytes[] = [];
const verifiedBytesCacheTtlMs = 15 * 60 * 1000;
const verifiedBytesCacheMaxEntries = 128;
const verifiedBytesCacheMaxBytes = 96 * 1024 * 1024;
const verifiedBytesCacheMaxEntryBytes = 12 * 1024 * 1024;
let verifiedBytesCacheBytes = 0;

function evictCachedVerifiedBytes(index: number) {
  const [removed] = verifiedBytesCache.splice(index, 1);
  if (!removed) return;
  verifiedBytesCacheBytes = Math.max(
    0,
    verifiedBytesCacheBytes - removed.bytes.byteLength,
  );
}

function trimCachedVerifiedBytes(now = Date.now()) {
  for (let index = verifiedBytesCache.length - 1; index >= 0; index -= 1) {
    const entry = verifiedBytesCache[index];
    if (!entry || entry.expiresAt > now) continue;
    evictCachedVerifiedBytes(index);
  }
  while (
    verifiedBytesCache.length > verifiedBytesCacheMaxEntries ||
    verifiedBytesCacheBytes > verifiedBytesCacheMaxBytes
  ) {
    evictCachedVerifiedBytes(0);
  }
}

function readCachedVerifiedBytes(key: string) {
  trimCachedVerifiedBytes();
  const index = verifiedBytesCache.findIndex((entry) => entry.key === key);
  if (index < 0) return null;
  const [hit] = verifiedBytesCache.splice(index, 1);
  if (!hit) return null;
  verifiedBytesCache.push(hit);
  return hit.bytes;
}

function rememberCachedVerifiedBytes(key: string, bytes: Uint8Array) {
  if (bytes.byteLength < 1 || bytes.byteLength > verifiedBytesCacheMaxEntryBytes)
    return;
  const existing = verifiedBytesCache.findIndex((entry) => entry.key === key);
  if (existing >= 0) evictCachedVerifiedBytes(existing);
  const stored = bytes.slice();
  verifiedBytesCache.push({
    key,
    bytes: stored,
    expiresAt: Date.now() + verifiedBytesCacheTtlMs,
  });
  verifiedBytesCacheBytes += stored.byteLength;
  trimCachedVerifiedBytes();
}

function cachedVerifiedBytesKey(input: {
  cacheScope: string;
  objectPath: string;
  size: number;
  sha: string;
  mime: string | null | undefined;
}) {
  return `${input.cacheScope}:${input.objectPath}:${input.size}:${normalizedMediaType(
    input.mime,
  )}:${input.sha}`;
}

export function clearVerifiedPrivateMediaCacheForTests() {
  verifiedBytesCache.length = 0;
  verifiedBytesCacheBytes = 0;
}

export function streamVerifiedBytes(
  source: ReadableStream<Uint8Array>,
  expectedSize: number,
  expectedSha: string,
) {
  const reader = source.getReader();
  const hash = createHash("sha256");
  let pending: Uint8Array | null = null;
  let seen = 0;
  let finished = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      // Keep reading inside this pull. A one-chunk body would otherwise sit
      // in `pending` with nothing enqueued, and the consumer would never ask
      // for pull again.
      while (true) {
        const next = await reader.read();
        if (next.done) {
          finished = true;
          if (pending) {
            hash.update(pending);
            seen += pending.byteLength;
          }
          const digest = hash.digest("hex");
          if (seen !== expectedSize || !sha256HexMatches(digest, expectedSha)) {
            controller.error(
              new Error("Private media did not match its descriptor"),
            );
            return;
          }
          if (pending) controller.enqueue(pending);
          pending = null;
          controller.close();
          return;
        }
        if (pending) {
          hash.update(pending);
          seen += pending.byteLength;
          if (seen > expectedSize) {
            controller.error(
              new Error("Private media did not match its descriptor"),
            );
            return;
          }
          const released = pending;
          pending = next.value;
          controller.enqueue(released);
          return;
        }
        pending = next.value;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

type PrivateObjectExpectation = Readonly<{
  size: unknown;
  mime: string | null | undefined;
  sha: unknown;
}>;

export async function openFetchedPrivateObject(
  upstream: Response,
  expected: PrivateObjectExpectation,
) {
  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    return null;
  }
  if (!mediaTypeMatches(upstream.headers.get("content-type"), expected.mime)) {
    await upstream.body.cancel();
    return null;
  }
  const size = declaredByteSize(expected.size);
  const sha = normalizedSha256Hex(expected.sha);
  if (size == null || !sha) {
    await upstream.body.cancel();
    return null;
  }
  if (!contentLengthAgrees(upstream.headers, size)) {
    await upstream.body.cancel();
    return null;
  }
  return {
    stream: streamVerifiedBytes(upstream.body, size, sha),
    contentType:
      normalizedMediaType(expected.mime) || "application/octet-stream",
    contentLength: upstream.headers.has("content-length") ? size : null,
  };
}

async function fetchSignedUrl(signedUrl: string) {
  try {
    return await fetch(signedUrl, { cache: "no-store", redirect: "error" });
  } catch {
    return null;
  }
}

export async function fetchSignedPrivateObject(
  bucket: SignedUrlBucket,
  objectPath: string,
) {
  const { data: signed, error } = await bucket.createSignedUrl(objectPath, 60);
  if (error || !signed?.signedUrl) return null;

  let upstream: Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return null;
  }

  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    return null;
  }

  const bytes = await upstream.arrayBuffer();
  if (!contentLengthAgrees(upstream.headers, bytes.byteLength)) return null;

  return {
    bytes,
    contentType: upstream.headers.get("content-type"),
  };
}

export async function openSignedPrivateObject(
  bucket: SignedUrlBucket,
  objectPath: string,
  expected: PrivateObjectExpectation,
) {
  const { data: signed, error } = await bucket.createSignedUrl(objectPath, 60);
  if (error || !signed?.signedUrl) return null;
  const upstream = await fetchSignedUrl(signed.signedUrl);
  if (!upstream) return null;
  return openFetchedPrivateObject(upstream, expected);
}

// Buffer the display derivative and accept it only when size, MIME, and
// SHA-256 all match. Callers that resize must use this instead of the stream.
export async function readVerifiedPrivateBytes(
  bucket: SignedUrlBucket,
  objectPath: string,
  expected: PrivateObjectExpectation,
) {
  const { data: signed, error } = await bucket.createSignedUrl(objectPath, 60);
  if (error || !signed?.signedUrl) return null;
  const upstream = await fetchSignedUrl(signed.signedUrl);
  if (!upstream) return null;
  if (upstream.status !== 200) {
    await upstream.body?.cancel();
    return null;
  }
  if (!mediaTypeMatches(upstream.headers.get("content-type"), expected.mime)) {
    await upstream.body?.cancel();
    return null;
  }
  const size = declaredByteSize(expected.size);
  const sha = normalizedSha256Hex(expected.sha);
  if (size == null || !sha) {
    await upstream.body?.cancel();
    return null;
  }
  if (!contentLengthAgrees(upstream.headers, size)) {
    await upstream.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength !== size) return null;
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!sha256HexMatches(digest, sha)) return null;
  return bytes;
}

// Stream the object and stop once the descriptor size is exceeded, including
// when Storage omits Content-Length. Callers that must fall back on a bad
// digest buffer the verified bytes and never emit a partial body.
export async function readCappedVerifiedPrivateBytes(
  bucket: SignedUrlBucket,
  objectPath: string,
  expected: PrivateObjectExpectation,
  cacheScope = "default",
) {
  const size = declaredByteSize(expected.size);
  const sha = normalizedSha256Hex(expected.sha);
  if (size == null || !sha) return null;
  const cacheKey = cachedVerifiedBytesKey({
    cacheScope,
    mime: expected.mime,
    objectPath,
    sha,
    size,
  });
  const cached = readCachedVerifiedBytes(cacheKey);
  if (cached) return cached.slice();
  const { data: signed, error } = await bucket.createSignedUrl(objectPath, 60);
  if (error || !signed?.signedUrl) return null;
  const upstream = await fetchSignedUrl(signed.signedUrl);
  if (!upstream) return null;
  if (upstream.status !== 200 || !upstream.body) {
    await upstream.body?.cancel();
    return null;
  }
  if (!mediaTypeMatches(upstream.headers.get("content-type"), expected.mime)) {
    await upstream.body.cancel();
    return null;
  }
  if (!contentLengthAgrees(upstream.headers, size)) {
    await upstream.body.cancel();
    return null;
  }
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const value = next.value;
      if (!value?.byteLength) continue;
      if (seen + value.byteLength > size) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      seen += value.byteLength;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  if (seen !== size) return null;
  const bytes = new Uint8Array(seen);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!sha256HexMatches(digest, sha)) return null;
  rememberCachedVerifiedBytes(cacheKey, bytes);
  return bytes;
}
