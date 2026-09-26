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

export function isDocumentGet(request: {
  method: string;
  nextUrl: { pathname: string };
  headers: { get(name: string): string | null };
}) {
  if (request.method !== "GET") return false;
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/") || path.startsWith("/_next/")) return false;
  if (request.headers.get("rsc") === "1") return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest === "document") return true;
  if (dest && dest !== "empty") return false;
  const accept = request.headers.get("accept") ?? "";
  return (
    accept.length === 0 ||
    accept.includes("text/html") ||
    accept.includes("*/*")
  );
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
    ? Buffer.from(value.slice("base64-".length), "base64url").toString("utf8")
    : value;
  return JSON.parse(encoded) as unknown;
}

function decodeJwtPart(token: string, index: number) {
  const part = token.split(".")[index];
  if (!part) return null;
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
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

export function documentAuthBudgetMs(request: CookieSource) {
  const token = readDocumentAccessToken(request);
  if (!token) return 200;
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
    const nearExpiry = exp == null || exp - Date.now() < expiryMarginMs;
    if (!asymmetric || nearExpiry) return 1_200;
    return 200;
  } catch {
    return 1_200;
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
