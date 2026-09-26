import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isDesignPreviewEnvironment } from "../config/design-preview-policy";
import { localJournalIsEnabled } from "../config/our-days-environment";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import type { Database } from "@/lib/supabase/database.types";
import { applyActiveCircleCookie } from "@/lib/auth/active-circle-middleware";
import { readOptionalSupabasePublicConfig } from "@/lib/supabase/public-config";

const journalDocumentRoots = [
  "/family",
  "/journal",
  "/trash",
  "/circles",
  "/people",
  "/memories",
  "/settings",
];

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isJournalDocumentPath(pathname: string) {
  const path = normalizePath(pathname);
  return journalDocumentRoots.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

function isDocumentRead(request: NextRequest) {
  return request.method === "GET" || request.method === "HEAD";
}

function hasSupabaseAuthSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name, value }) => {
    if (value.trim().length === 0) return false;
    return /^sb-.+-auth-token(?:\.\d+)?$/u.test(name);
  });
}

function isRscRequest(request: NextRequest) {
  // Next removes `rsc` and `_rsc` before this proxy runs. Client navigations
  // still send `next-url`, and the flight accept type is left intact.
  const accept = request.headers.get("accept") ?? "";
  return (
    request.headers.get("rsc") === "1" ||
    request.nextUrl.searchParams.has("_rsc") ||
    request.headers.has("next-url") ||
    accept.includes("text/x-component")
  );
}

function shouldRedirectSignedOutJournal(request: NextRequest) {
  if (!isDocumentRead(request)) return false;
  if (isRscRequest(request)) return false;
  if (!isJournalDocumentPath(request.nextUrl.pathname)) return false;
  if (isDesignPreviewEnvironment(process.env)) return false;
  if (localJournalIsEnabled(process.env)) return false;
  return true;
}

function redirectSignedOutJournal(request: NextRequest, source: NextResponse) {
  const destination = request.nextUrl.clone();
  destination.pathname = "/sign-in";
  destination.search = "";
  const redirect = NextResponse.redirect(destination, 307);
  const policy = source.headers.get("Content-Security-Policy");
  if (policy) redirect.headers.set("Content-Security-Policy", policy);
  redirect.headers.set("Cache-Control", "private, no-store, max-age=0");
  redirect.headers.set("Pragma", "no-cache");
  redirect.headers.set("Expires", "0");
  redirect.headers.set(
    "X-Robots-Tag",
    "noindex, nofollow, noarchive, nosnippet",
  );
  for (const cookie of source.headers.getSetCookie()) {
    redirect.headers.append("set-cookie", cookie);
  }
  return redirect;
}

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
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
  if (request.nextUrl.pathname.startsWith("/_next/static/")) return response;
  response = applyActiveCircleCookie(request, response);
  const supabaseConfig = readOptionalSupabasePublicConfig();
  // No auth cookie means there is no session to refresh. A present cookie can
  // still be valid, so a failed claims read must reach the page.
  if (!supabaseConfig || !hasSupabaseAuthSessionCookie(request)) {
    if (shouldRedirectSignedOutJournal(request)) {
      return redirectSignedOutJournal(request, response);
    }
    return response;
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

  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error || data?.claims?.sub) return response;
  } catch {
    return response;
  }
  if (shouldRedirectSignedOutJournal(request)) {
    return redirectSignedOutJournal(request, response);
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!(?:our-days-wordmark\\.svg|apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-1024\\.png|og\\.png|sample-family\\.jpg|synthetic-short\\.mp4|sw\\.js)$).*)",
  ],
};
