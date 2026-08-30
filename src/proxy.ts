import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/content-security-policy";

export function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!(?:apple-touch-icon\\.png|icon-192\\.png|icon-512\\.png|icon-1024\\.png|og\\.png|sample-family\\.jpg|sw\\.js)$).*)",
  ],
};
