import { NextResponse } from "next/server";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../../../../config/our-days-environment";
import {
  exchangeAuthorizationCode,
  oauthCallbackUrl,
  OAuthIdentityError,
  readOAuthProviderConfig,
} from "@/lib/auth/oauth-protocol";
import { expireOAuthState, readOAuthState } from "@/lib/auth/oauth-state";
import { createLocalJournalSession } from "@/lib/local-journal/auth";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function siteOrigin(request: Request) {
  const resolved = resolvedSiteOrigin();
  if (resolved) return new URL(resolved).origin;
  return new URL(request.url).origin;
}

function appRedirect(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  for (const [key, value] of Object.entries(privateHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error || !code || !state) {
    await expireOAuthState();
    return appRedirect(request, "/sign-in?oauth=invalid");
  }

  if (!localJournalIsEnabled()) {
    await expireOAuthState();
    return appRedirect(request, "/sign-in?oauth=unavailable");
  }

  const pending = await readOAuthState();
  await expireOAuthState();
  if (!pending || pending.nonce !== state) {
    return appRedirect(request, "/sign-in?oauth=invalid");
  }

  const config = readOAuthProviderConfig(pending.provider);
  if (!config) return appRedirect(request, "/sign-in?oauth=unavailable");

  try {
    const email = await exchangeAuthorizationCode(config, {
      code,
      redirectUri: oauthCallbackUrl(siteOrigin(request)),
      verifier: pending.verifier,
    });
    const session = await createLocalJournalSession(email);
    if (!session) return appRedirect(request, "/sign-in?oauth=no-access");
    return appRedirect(request, "/family");
  } catch (cause) {
    if (cause instanceof OAuthIdentityError && cause.code === "no-email") {
      return appRedirect(request, "/sign-in?oauth=no-email");
    }
    return appRedirect(request, "/sign-in?oauth=invalid");
  }
}
