const expiryMarginMs = 90_000;
const jwksTtlMs = 60 * 60 * 1000;
const authCookiePattern = /^sb-.+-auth-token(?:\.\d+)?$/u;

type SigningKey = Record<string, unknown> & { kid?: string };

type CookieSource = Readonly<{
  cookies: {
    getAll(): readonly { name: string; value: string }[];
  };
}>;

const jwksCache = new Map<
  string,
  Readonly<{ keys: SigningKey[]; fetchedAt: number }>
>();

function labAuthEnabled() {
  if (process.env.OUR_DAYS_LAB !== "1") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.OUR_DAYS_LAB !== "1"
  ) {
    return false;
  }
  return true;
}

export function labAuthMustBlockDocument() {
  return labAuthEnabled() && process.env.OUR_DAYS_LAB_AUTH_BLOCKING === "1";
}

export async function labAuthNetworkDelay() {
  if (!labAuthMustBlockDocument()) return;
  const raw = process.env.OUR_DAYS_LAB_AUTH_DELAY_MS;
  if (!raw) return;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

export function isDocumentGet(request: {
  method: string;
  nextUrl: {
    pathname: string;
    searchParams: { has(name: string): boolean };
  };
  headers: { get(name: string): string | null };
}) {
  if (request.method !== "GET") return false;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return false;
  // Next strips `rsc` before proxy runs. Flight and prefetch requests keep
  // `_rsc`, the router headers, or `text/x-component`.
  if (request.nextUrl.searchParams.has("_rsc")) return false;
  if (
    request.headers.get("next-router-prefetch") ||
    request.headers.get("next-router-state-tree") ||
    request.headers.get("next-router-segment-prefetch") ||
    request.headers.get("next-url")
  ) {
    return false;
  }
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html") || accept.includes("text/x-component")) {
    return false;
  }
  const dest = request.headers.get("sec-fetch-dest");
  return !dest || dest === "document" || dest === "empty";
}

function combineAuthCookie(request: CookieSource) {
  const cookies = request.cookies
    .getAll()
    .filter((cookie) => authCookiePattern.test(cookie.name));
  const whole = cookies.find((cookie) => !cookie.name.includes("."));
  if (whole?.value) return whole.value;
  const chunks = cookies
    .map((cookie) => {
      const index = Number(cookie.name.split(".").at(-1));
      return Number.isInteger(index) ? { index, value: cookie.value } : null;
    })
    .filter((chunk): chunk is { index: number; value: string } =>
      Boolean(chunk),
    )
    .sort((left, right) => left.index - right.index);
  if (chunks.length === 0) return null;
  return chunks.map((chunk) => chunk.value).join("");
}

function decodeJson(value: string) {
  const encoded = value.startsWith("base64-")
    ? decodeBase64Url(value.slice("base64-".length))
    : value;
  return JSON.parse(encoded) as unknown;
}

function decodeJwtPart(token: string, index: number) {
  const part = token.split(".")[index];
  if (!part) return null;
  return JSON.parse(decodeBase64Url(part)) as unknown;
}

export function readDocumentAccessToken(request: CookieSource) {
  try {
    const raw = combineAuthCookie(request);
    if (!raw) return null;
    const session = decodeJson(raw);
    if (
      typeof session !== "object" ||
      session === null ||
      !("access_token" in session) ||
      typeof session.access_token !== "string"
    ) {
      return null;
    }
    return session.access_token;
  } catch {
    return null;
  }
}

function hasAuthCookie(request: CookieSource) {
  return request.cookies
    .getAll()
    .some((cookie) => authCookiePattern.test(cookie.name));
}

/** A number budgets the wait. Null means wait for getClaims so cookie writes land. */
export function documentAuthBudgetMs(request: CookieSource) {
  const token = readDocumentAccessToken(request);
  if (!token) return hasAuthCookie(request) ? null : 200;
  try {
    const header = decodeJwtPart(token, 0);
    const payload = decodeJwtPart(token, 1);
    const alg =
      typeof header === "object" &&
      header !== null &&
      "alg" in header &&
      typeof header.alg === "string"
        ? header.alg
        : "";
    const kid =
      typeof header === "object" &&
      header !== null &&
      "kid" in header &&
      typeof header.kid === "string"
        ? header.kid
        : "";
    const exp =
      typeof payload === "object" &&
      payload !== null &&
      "exp" in payload &&
      typeof payload.exp === "number"
        ? payload.exp * 1000
        : null;
    const asymmetric = Boolean(alg) && !alg.startsWith("HS") && kid.length > 0;
    const fresh = exp != null && exp - Date.now() >= expiryMarginMs;
    if (asymmetric && fresh) return 200;
    return null;
  } catch {
    return null;
  }
}

export function readCachedJwks(supabaseUrl: string) {
  return jwksCache.get(supabaseUrl)?.keys ?? null;
}

export function cachedJwksAreFresh(supabaseUrl: string) {
  const cached = jwksCache.get(supabaseUrl);
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < jwksTtlMs;
}

export function rememberJwks(supabaseUrl: string, keys: readonly SigningKey[]) {
  if (keys.length === 0) return;
  jwksCache.set(supabaseUrl, { keys: [...keys], fetchedAt: Date.now() });
}

export function clearCachedJwks() {
  jwksCache.clear();
}

export async function refreshJwks(supabaseUrl: string, timeoutMs = 1_500) {
  try {
    const response = await fetch(
      new URL("/auth/v1/.well-known/jwks.json", supabaseUrl),
      { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!response.ok) return;
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0) return;
    const keys = body.keys.filter(
      (key): key is SigningKey =>
        typeof key === "object" && key !== null && !Array.isArray(key),
    );
    rememberJwks(supabaseUrl, keys);
  } catch {
    // A stalled discovery endpoint must not throw. The previous keys stay usable.
  }
}
