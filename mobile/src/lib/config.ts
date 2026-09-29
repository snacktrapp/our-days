/**
 * Public project coordinates. The publishable key is not committed.
 * Same Supabase project the web app uses (snwmwzbeajfrateksolo) and the
 * hosted Next.js origin that serves private media.
 */
export const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  "https://snwmwzbeajfrateksolo.supabase.co";

export const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const siteOrigin = (
  process.env.EXPO_PUBLIC_SITE_URL ?? "https://our-days-neon.vercel.app"
).replace(/\/$/u, "");

export function isConfigured() {
  return supabaseUrl.length > 0 && supabasePublishableKey.length > 0;
}

/** Cookie name @supabase/ssr uses for this project URL. */
export function authStorageKey(url: string = supabaseUrl) {
  const ref = new URL(url).hostname.split(".")[0] ?? "our-days";
  return `sb-${ref}-auth-token`;
}
