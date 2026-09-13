const genericBlobTypes = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

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
  return received === wanted;
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

  return {
    bytes: await upstream.arrayBuffer(),
    contentType: upstream.headers.get("content-type"),
  };
}
