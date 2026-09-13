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
};

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
