import { NextResponse } from "next/server";
import {
  localJournalIsEnabled,
  supabaseResourceIsActive,
} from "../../../../../../config/our-days-environment";
import {
  isOAuthProvider,
  oauthAuthorizationUrl,
  oauthCallbackUrl,
  readOAuthProviderConfig,
  supabaseOAuthProvider,
} from "@/lib/auth/oauth-protocol";
import { createOAuthState, oauthStateCookieName } from "@/lib/auth/oauth-state";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const;

function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function appRedirect(request: Request, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  for (const [key, value] of Object.entries(privateHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function GET(
  request: Request,
  context: Readonly<{ params: Promise<{ provider: string }> }>,
) {
  const { provider: rawProvider } = await context.params;
  if (!isOAuthProvider(rawProvider)) {
    return appRedirect(request, "/sign-in?oauth=invalid");
  }

  const origin = siteOrigin(request);

  if (localJournalIsEnabled()) {
    const config = readOAuthProviderConfig(rawProvider);
    if (!config) return appRedirect(request, "/sign-in?oauth=unavailable");
    const started = createOAuthState(rawProvider);
    const authorizationUrl = oauthAuthorizationUrl(config, {
      redirectUri: oauthCallbackUrl(origin),
      state: started.nonce,
      codeChallenge: started.challenge,
    });
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(oauthStateCookieName, started.token, started.cookie);
    for (const [key, value] of Object.entries(privateHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (!supabaseResourceIsActive()) {
    return appRedirect(request, "/sign-in?oauth=unavailable");
  }

  try {
    const supabase = await createOurDaysServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: supabaseOAuthProvider(rawProvider),
      options: {
        redirectTo: new URL("/auth/callback", origin).toString(),
        skipBrowserRedirect: true,
        queryParams:
          rawProvider === "google" ? { prompt: "select_account" } : undefined,
      },
    });
    if (error || !data.url) {
      return appRedirect(request, "/sign-in?oauth=unavailable");
    }
    const response = NextResponse.redirect(data.url);
    for (const [key, value] of Object.entries(privateHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  } catch {
    return appRedirect(request, "/sign-in?oauth=unavailable");
  }
}
