import { resolveSupabaseOrigin } from "../../config/supabase-origin";

const NONCE_PATTERN = /^[A-Za-z0-9+/_=-]{22,128}$/u;

type ContentSecurityPolicyOptions = Readonly<{
  nonce: string;
  development: boolean;
  siteUrl?: string;
  supabaseUrl?: string;
}>;

function isLoopbackSite(siteUrl?: string) {
  if (!siteUrl) return false;
  try {
    const url = new URL(siteUrl);
    return (
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function normalizedSupabaseOrigins(supabaseUrl?: string) {
  if (!supabaseUrl)
    return { http: undefined, storageHttp: undefined, websocket: undefined };
  const resolved = resolveSupabaseOrigin(supabaseUrl);
  return {
    http: resolved.http,
    storageHttp: resolved.storageHttp,
    websocket: resolved.websocket,
  };
}

export function buildContentSecurityPolicy({
  nonce,
  development,
  siteUrl,
  supabaseUrl,
}: ContentSecurityPolicyOptions) {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("The CSP nonce is invalid.");
  }

  const supabase = normalizedSupabaseOrigins(supabaseUrl);
  const directives = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    ["script-src-attr", "'none'"],
    [
      "style-src",
      "'self'",
      ...(development ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`]),
    ],
    ["style-src-attr", "'none'"],
    ["img-src", "'self'", "blob:", "data:", supabase.http],
    ["media-src", "'self'", "blob:", supabase.http],
    ["font-src", "'self'"],
    [
      "connect-src",
      "'self'",
      "blob:",
      ...(development ? ["ws:"] : []),
      supabase.http,
      supabase.storageHttp,
      supabase.websocket,
    ],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
    ...(!development && !isLoopbackSite(siteUrl)
      ? [["upgrade-insecure-requests"]]
      : []),
  ];

  return directives
    .map(([directive, ...values]) =>
      [directive, ...values.filter(Boolean)].join(" "),
    )
    .join("; ");
}
