export const oauthProviders = ["google", "x"] as const;

export type OAuthProvider = (typeof oauthProviders)[number];

export type OAuthProviderConfig = Readonly<{
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
}>;

export class OAuthIdentityError extends Error {
  readonly code: "unavailable" | "invalid" | "no-email";

  constructor(code: "unavailable" | "invalid" | "no-email", message: string) {
    super(message);
    this.name = "OAuthIdentityError";
    this.code = code;
  }
}

type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function isOAuthProvider(value: string): value is OAuthProvider {
  return oauthProviders.includes(value as OAuthProvider);
}

export function supabaseOAuthProvider(provider: OAuthProvider) {
  return provider === "x" ? "twitter" : "google";
}

function trimmed(environment: ProcessEnvironment, name: string) {
  const value = environment[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function readOAuthProviderConfig(
  provider: OAuthProvider,
  environment: ProcessEnvironment = process.env,
): OAuthProviderConfig | null {
  const clientId = trimmed(
    environment,
    provider === "google"
      ? "OUR_DAYS_GOOGLE_CLIENT_ID"
      : "OUR_DAYS_X_CLIENT_ID",
  );
  const clientSecret = trimmed(
    environment,
    provider === "google"
      ? "OUR_DAYS_GOOGLE_CLIENT_SECRET"
      : "OUR_DAYS_X_CLIENT_SECRET",
  );
  if (!clientId || !clientSecret) return null;
  return { provider, clientId, clientSecret };
}

export function oauthCallbackUrl(siteOrigin: string) {
  return new URL("/api/auth/oauth/callback", siteOrigin).toString();
}

export function oauthAuthorizationUrl(
  config: OAuthProviderConfig,
  input: Readonly<{
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }>,
) {
  if (config.provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    return url;
  }

  const url = new URL("https://twitter.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "users.read tweet.read offline.access");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

function normalizedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!SIMPLE_EMAIL.test(email) || email.length > 254) return null;
  return email;
}

function readJson(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function emailFromGoogleIdentity(payload: Record<string, unknown>) {
  if (payload.email_verified === false) return null;
  return normalizedEmail(payload.email);
}

function emailFromXIdentity(payload: Record<string, unknown>) {
  const data = readJson(payload.data) ?? payload;
  return (
    normalizedEmail(data.confirmed_email) ?? normalizedEmail(data.email) ?? null
  );
}

export function emailFromOAuthTokenResponse(
  provider: OAuthProvider,
  tokenPayload: unknown,
  userPayload?: unknown,
) {
  if (provider === "google") {
    const user = readJson(userPayload);
    if (user) {
      const email = emailFromGoogleIdentity(user);
      if (email) return email;
    }
    const token = readJson(tokenPayload);
    const idToken = typeof token?.id_token === "string" ? token.id_token : "";
    const segment = idToken.split(".")[1];
    if (!segment) return null;
    try {
      const claims = readJson(
        JSON.parse(Buffer.from(segment, "base64url").toString("utf8")),
      );
      return claims ? emailFromGoogleIdentity(claims) : null;
    } catch {
      return null;
    }
  }

  const user = readJson(userPayload);
  return user ? emailFromXIdentity(user) : null;
}

export async function exchangeAuthorizationCode(
  config: OAuthProviderConfig,
  input: Readonly<{
    code: string;
    redirectUri: string;
    verifier: string;
  }>,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (config.provider === "google") {
    const tokenResponse = await fetchImpl(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: input.redirectUri,
          grant_type: "authorization_code",
          code_verifier: input.verifier,
        }),
      },
    );
    const tokenPayload: unknown = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok) {
      throw new OAuthIdentityError("invalid", "Google token exchange failed.");
    }
    const accessToken = readJson(tokenPayload)?.access_token;
    let userPayload: unknown;
    if (typeof accessToken === "string" && accessToken) {
      const userResponse = await fetchImpl(
        "https://openidconnect.googleapis.com/userinfo",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      userPayload = await userResponse.json().catch(() => null);
    }
    const email = emailFromOAuthTokenResponse(
      "google",
      tokenPayload,
      userPayload,
    );
    if (!email) {
      throw new OAuthIdentityError(
        "no-email",
        "Google did not share a verified email address.",
      );
    }
    return email;
  }

  const tokenResponse = await fetchImpl(
    "https://api.twitter.com/2/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
        client_id: config.clientId,
      }),
    },
  );
  const tokenPayload: unknown = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok) {
    throw new OAuthIdentityError("invalid", "X token exchange failed.");
  }
  const accessToken = readJson(tokenPayload)?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new OAuthIdentityError("invalid", "X token exchange failed.");
  }
  const userResponse = await fetchImpl(
    "https://api.twitter.com/2/users/me?user.fields=confirmed_email",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const userPayload: unknown = await userResponse.json().catch(() => null);
  if (!userResponse.ok) {
    throw new OAuthIdentityError("invalid", "X profile lookup failed.");
  }
  const email = emailFromOAuthTokenResponse("x", tokenPayload, userPayload);
  if (!email) {
    throw new OAuthIdentityError(
      "no-email",
      "X did not share an email we can match to a family invitation.",
    );
  }
  return email;
}
