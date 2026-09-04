import { describe, expect, it, vi } from "vitest";
import {
  emailFromOAuthTokenResponse,
  exchangeAuthorizationCode,
  oauthAuthorizationUrl,
  oauthCallbackUrl,
  OAuthIdentityError,
  readOAuthProviderConfig,
  supabaseOAuthProvider,
} from "./oauth-protocol";

describe("OAuth protocol", () => {
  it("maps app providers to hosted Auth provider ids", () => {
    expect(supabaseOAuthProvider("google")).toBe("google");
    expect(supabaseOAuthProvider("x")).toBe("x");
  });

  it("reads complete Google and X pairs and ignores blanks", () => {
    expect(readOAuthProviderConfig("google", {})).toBeNull();
    expect(
      readOAuthProviderConfig("google", {
        OUR_DAYS_GOOGLE_CLIENT_ID: "google-id.apps.googleusercontent.com",
      }),
    ).toBeNull();
    expect(
      readOAuthProviderConfig("google", {
        OUR_DAYS_GOOGLE_CLIENT_ID: "google-id.apps.googleusercontent.com",
        OUR_DAYS_GOOGLE_CLIENT_SECRET: "google-secret",
      }),
    ).toEqual({
      provider: "google",
      clientId: "google-id.apps.googleusercontent.com",
      clientSecret: "google-secret",
    });
    expect(
      readOAuthProviderConfig("x", {
        OUR_DAYS_X_CLIENT_ID: "x-id",
        OUR_DAYS_X_CLIENT_SECRET: "x-secret",
      }),
    ).toEqual({
      provider: "x",
      clientId: "x-id",
      clientSecret: "x-secret",
    });
  });

  it("builds first-party authorize URLs with PKCE", () => {
    const google = oauthAuthorizationUrl(
      {
        provider: "google",
        clientId: "google-id.apps.googleusercontent.com",
        clientSecret: "google-secret",
      },
      {
        redirectUri: "http://127.0.0.1:3000/api/auth/oauth/callback",
        state: "state-1",
        codeChallenge: "challenge-1",
      },
    );
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("client_id")).toBe(
      "google-id.apps.googleusercontent.com",
    );
    expect(google.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/auth/oauth/callback",
    );
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");

    const x = oauthAuthorizationUrl(
      {
        provider: "x",
        clientId: "x-id",
        clientSecret: "x-secret",
      },
      {
        redirectUri: "http://127.0.0.1:3000/api/auth/oauth/callback",
        state: "state-2",
        codeChallenge: "challenge-2",
      },
    );
    expect(x.origin).toBe("https://twitter.com");
    expect(x.searchParams.get("scope")).toBe(
      "users.read tweet.read offline.access",
    );
    expect(oauthCallbackUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000/api/auth/oauth/callback",
    );
  });

  it("accepts a verified Google email and rejects an unverified one", () => {
    expect(
      emailFromOAuthTokenResponse(
        "google",
        {},
        {
          email: "  FAMILY@example.com ",
          email_verified: true,
        },
      ),
    ).toBe("family@example.com");
    expect(
      emailFromOAuthTokenResponse(
        "google",
        {},
        {
          email: "family@example.com",
          email_verified: false,
        },
      ),
    ).toBeNull();
  });

  it("reads X confirmed_email and fails closed without one", () => {
    expect(
      emailFromOAuthTokenResponse(
        "x",
        {},
        {
          data: { confirmed_email: "jordan@example.com", username: "jordan" },
        },
      ),
    ).toBe("jordan@example.com");
    expect(
      emailFromOAuthTokenResponse(
        "x",
        {},
        {
          data: { username: "stranger" },
        },
      ),
    ).toBeNull();
  });

  it("exchanges a Google code for a verified email", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "google-access" });
      }
      expect(url).toBe("https://openidconnect.googleapis.com/userinfo");
      return Response.json({
        email: "family@example.com",
        email_verified: true,
      });
    });

    await expect(
      exchangeAuthorizationCode(
        {
          provider: "google",
          clientId: "google-id",
          clientSecret: "google-secret",
        },
        {
          code: "one-time",
          redirectUri: "http://127.0.0.1:3000/api/auth/oauth/callback",
          verifier: "verifier",
        },
        fetchImpl as typeof fetch,
      ),
    ).resolves.toBe("family@example.com");
  });

  it("fails closed when X shares no email", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.twitter.com/2/oauth2/token") {
        return Response.json({ access_token: "x-access" });
      }
      return Response.json({ data: { username: "stranger" } });
    });

    await expect(
      exchangeAuthorizationCode(
        {
          provider: "x",
          clientId: "x-id",
          clientSecret: "x-secret",
        },
        {
          code: "one-time",
          redirectUri: "http://127.0.0.1:3000/api/auth/oauth/callback",
          verifier: "verifier",
        },
        fetchImpl as typeof fetch,
      ),
    ).rejects.toMatchObject({
      name: "OAuthIdentityError",
      code: "no-email",
    } satisfies Partial<OAuthIdentityError>);
  });
});
