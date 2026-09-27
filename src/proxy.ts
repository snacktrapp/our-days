import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  cachedJwksAreFresh,
  documentAuthBudgetMs,
  isDocumentGet,
  labAuthMustBlockDocument,
  labAuthNetworkDelay,
  readCachedJwks,
  refreshJwks,
} from "@/lib/auth/document-auth";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import type { Database } from "@/lib/supabase/database.types";
import { applyActiveCircleCookie } from "@/lib/auth/active-circle-middleware";
import { readOptionalSupabasePublicConfig } from "@/lib/supabase/public-config";
import {
  requestTimingHeader,
  trackDocumentHeaders,
  upsertServerTiming,
} from "@/lib/server-timing";

function randomBase64(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function randomHex(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function finish(
  request: NextRequest,
  response: NextResponse,
  requestId: string,
  started: number,
  trackTiming: boolean,
) {
  const finished = applyActiveCircleCookie(request, response);
  upsertServerTiming(finished.headers, "proxy", performance.now() - started);
  if (trackTiming) trackDocumentHeaders(requestId, finished.headers);
  return finished;
}

export async function proxy(request: NextRequest) {
  const started = performance.now();
  const requestId = randomHex(8);
  const nonce = randomBase64(18);
  const embeddableMap =
    request.nextUrl.pathname === "/internal/map-picker" ||
    request.nextUrl.pathname === "/internal/map-picker/";
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    embeddableMap,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(requestTimingHeader, requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const buildResponse = () => {
    const nextResponse = NextResponse.next({
      request: { headers: requestHeaders },
    });
    nextResponse.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return nextResponse;
  };

  let response = buildResponse();
  // Loading application assets must not wait for a session refresh. This is
  // especially important on a fresh Home Screen install with an empty cache.
  // Keep the response policy, but authenticate pages and APIs, not JS/CSS.
  if (request.nextUrl.pathname.startsWith("/_next/static/")) {
    return finish(request, response, requestId, started, false);
  }
  const supabaseConfig = readOptionalSupabasePublicConfig();
  const documentGet = isDocumentGet(request);
  const blockOnLabAuth = documentGet && labAuthMustBlockDocument();

  if (!supabaseConfig) {
    if (blockOnLabAuth) await labAuthNetworkDelay();
    return finish(request, response, requestId, started, true);
  }

  const supabase = createServerClient<Database>(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, cacheHeaders) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          requestHeaders.set("cookie", request.cookies.toString());

          response = buildResponse();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [name, value] of Object.entries(cacheHeaders)) {
            response.headers.set(name, value);
          }
        },
      },
    },
  );

  const verifySession = async () => {
    if (blockOnLabAuth) await labAuthNetworkDelay();
    if (!cachedJwksAreFresh(supabaseConfig.url)) {
      void refreshJwks(supabaseConfig.url);
    }
    const keys = readCachedJwks(supabaseConfig.url);
    try {
      await supabase.auth.getClaims(
        undefined,
        keys ? { jwks: { keys: keys as never } } : undefined,
      );
    } catch {
      // A stalled Auth call must not fail the document. The page and RPCs
      // remain the authority for who is signed in.
    }
  };

  const budgetMs =
    documentGet && !blockOnLabAuth ? documentAuthBudgetMs(request) : null;
  if (budgetMs == null) {
    await verifySession();
  } else {
    await Promise.race([
      verifySession(),
      new Promise((resolve) => setTimeout(resolve, budgetMs)),
    ]);
  }
  return finish(request, response, requestId, started, true);
}

export const config = {
  matcher: [
    "/((?!(?:our-days-wordmark\\.svg|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-1024\\.png|og\\.png|sample-family\\.jpg|synthetic-short\\.mp4|sw\\.js)$).*)",
  ],
};
