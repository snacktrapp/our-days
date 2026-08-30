import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { readSupabasePublicConfig } from "./public-config";

export async function createOurDaysServerClient() {
  const { url, publishableKey } = readSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The request-wide proxy
          // refreshes sessions before protected rendering; actions and route
          // handlers can write through this same request-scoped adapter.
        }
      },
    },
  });
}
