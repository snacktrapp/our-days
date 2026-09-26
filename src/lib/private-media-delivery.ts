import { createHash } from "node:crypto";

const genericBlobTypes = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

const iphoneVideoTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
]);

const jpegTypes = new Set(["image/jpeg", "image/jpg"]);

const sha256HexPattern = /^[0-9a-f]{64}$/u;

export function declaredByteSize(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

export function normalizedMediaType(value: string | null | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function mediaTypeMatches(
  actual: string | null | undefined,
  expected: string | null | undefined,
) {
  const wanted = normalizedMediaType(expected);
  if (!wanted) return false;
  const received = normalizedMediaType(actual);
  if (genericBlobTypes.has(received)) return true;
  if (iphoneVideoTypes.has(wanted) && iphoneVideoTypes.has(received)) {
    return true;
  }
  if (jpegTypes.has(wanted) && jpegTypes.has(received)) return true;
  return received === wanted;
}

export function normalizedSha256Hex(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase().replace(/^\\x/u, "");
  return sha256HexPattern.test(trimmed) ? trimmed : null;
}

export function sha256HexMatches(actual: unknown, expected: unknown) {
  const got = normalizedSha256Hex(actual);
  const wanted = normalizedSha256Hex(expected);
  return got !== null && wanted !== null && got === wanted;
}

export function contentLengthAgrees(headers: Headers, expectedSize: number) {
  if (!headers.has("content-length")) return true;
  return byteSizeMatches(Number(headers.get("content-length")), expectedSize);
}

export function byteSizeMatches(actual: number, expected: unknown) {
  const wanted = declaredByteSize(expected);
  return wanted !== null && actual === wanted;
}

export function privateMediaRetrySrc(src: string, attempt: number) {
  if (attempt <= 0) return src;
  const hashIndex = src.indexOf("#");
  const pathAndQuery = hashIndex === -1 ? src : src.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : src.slice(hashIndex);
  const joiner = pathAndQuery.includes("?") ? "&" : "?";
  return `${pathAndQuery}${joiner}retry=${attempt}${hash}`;
}

type SignedUrlBucket = {
  createSignedUrl: (
    path: string,
    expiresIn: number,
  ) => Promise<{
    data: { signedUrl?: string | null } | null;
    error: unknown;
  }>;
  createSignedUrls?: (
    paths: string[],
    expiresIn: number,
  ) => Promise<{
    data:
      | {
          error?: string | null;
          path?: string | null;
          signedUrl?: string | null;
        }[]
      | null;
    error: unknown;
  }>;
};

const signedUrlTtlMs = 45_000;
const signedUrls = new Map<
  string,
  Readonly<{ url: string; expiresAt: number }>
>();

export function rememberSignedPrivateUrls(
  entries: readonly { path: string; signedUrl: string }[],
) {
  const expiresAt = Date.now() + signedUrlTtlMs;
  for (const entry of entries) {
    if (!entry.path || !entry.signedUrl) continue;
    signedUrls.set(entry.path, { url: entry.signedUrl, expiresAt });
  }
}

export function readSignedPrivateUrl(path: string) {
  const entry = signedUrls.get(path);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    signedUrls.delete(path);
    return null;
  }
  return entry.url;
}

export function clearSignedPrivateUrls() {
  signedUrls.clear();
}

export async function warmSignedPhotoUrls(
  storage: {
    from: (bucket: string) => SignedUrlBucket;
  },
  rows: readonly { bucket_id: string; object_path: string }[],
) {
  const pathsByBucket = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.bucket_id || !row.object_path) continue;
    const paths = pathsByBucket.get(row.bucket_id) ?? [];
    if (!paths.includes(row.object_path)) paths.push(row.object_path);
    pathsByBucket.set(row.bucket_id, paths);
  }
  for (const [bucket, paths] of pathsByBucket) {
    const signer = storage.from(bucket);
    if (!signer.createSignedUrls) continue;
    const signed = await signer.createSignedUrls(paths, 60);
    if (signed.error || !signed.data) continue;
    rememberSignedPrivateUrls(
      signed.data.flatMap((item) =>
        item.path && item.signedUrl && !item.error
          ? [{ path: item.path, signedUrl: item.signedUrl }]
          : [],
      ),
    );
  }
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
  const cached = readSignedPrivateUrl(objectPath);
  if (cached) {
    const upstream = await fetchSignedUrl(cached);
    const opened = upstream
      ? await openFetchedPrivateObject(upstream, expected)
      : null;
    if (opened) return opened;
  }

  const { data: signed, error } = await bucket.createSignedUrl(objectPath, 60);
  if (error || !signed?.signedUrl) return null;
  const upstream = await fetchSignedUrl(signed.signedUrl);
  if (!upstream) return null;
  return openFetchedPrivateObject(upstream, expected);
}
