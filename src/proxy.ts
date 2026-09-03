import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";
import type { Database } from "@/lib/supabase/database.types";
import { readOptionalSupabasePublicConfig } from "@/lib/supabase/public-config";

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
  const supabaseConfig = readOptionalSupabasePublicConfig();
  if (!supabaseConfig) return response;

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

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    "/((?!(?:apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-1024\\.png|og\\.png|sample-family\\.jpg|sw\\.js)$).*)",
  ],
};
