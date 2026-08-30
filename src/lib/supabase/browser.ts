"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { readSupabasePublicConfig } from "./public-config";

export function createOurDaysBrowserClient() {
  const { url, publishableKey } = readSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}
