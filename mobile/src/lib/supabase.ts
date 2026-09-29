import "react-native-url-polyfill/auto";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

import { sessionCookieHeader } from "./auth-cookie";
import {
  authStorageKey,
  isConfigured,
  siteOrigin,
  supabasePublishableKey,
  supabaseUrl,
} from "./config";
import { secureSessionStorage } from "./secure-session";

let client: SupabaseClient | null = null;

export function getSupabase() {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
  }
  return client;
}

export async function mediaRequestHeaders() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  let session: Session | null = data.session;
  if (!session) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs < Date.now() + 60_000) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session ?? session;
  }

  return { Cookie: sessionCookieHeader(authStorageKey(), session) };
}

export function mediaUrl(path: string) {
  return `${siteOrigin}${path}`;
}
