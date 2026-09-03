"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { readSupabasePublicConfig } from "./public-config";

export function createOurDaysBrowserClient() {
  const { url, publishableKey } = readSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}

export function createOurDaysInviteCompletionClient() {
  const { url, publishableKey } = readSupabasePublicConfig();
  // The shared browser client is a PKCE singleton that auto-detects the URL.
  // Implicit invite tokens arrive in the hash; that client treats them as an
  // invalid PKCE callback. This one only writes cookies from setSession /
  // verifyOtp and never inspects the address bar.
  return createBrowserClient<Database>(url, publishableKey, {
    isSingleton: false,
    auth: { detectSessionInUrl: false },
  });
}
