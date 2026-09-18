import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { readSupabasePublicConfig } from "./public-config";

export async function createOurDaysServerClient(
  options: Readonly<{ readTimeoutMs?: number }> = {},
) {
  const { url, publishableKey } = readSupabasePublicConfig();
  const cookieStore = await cookies();
  const traceReads = process.env.VERCEL_ENV === "preview";

  return createServerClient<Database>(url, publishableKey, {
    ...(options.readTimeoutMs || traceReads
      ? {
          global: {
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
              const started = performance.now();
              let status: number | null = null;
              try {
                const response = await fetch(input, {
                  ...init,
                  ...(options.readTimeoutMs
                    ? {
                        signal: AbortSignal.any([
                          ...(init?.signal ? [init.signal] : []),
                          AbortSignal.timeout(options.readTimeoutMs!),
                        ]),
                      }
                    : {}),
                });
                status = response.status;
                return response;
              } finally {
                if (traceReads) {
                  // No query parameters, object paths, request bodies, or IDs.
                  const path = new URL(
                    typeof input === "string"
                      ? input
                      : input instanceof URL
                        ? input.href
                        : input.url,
                  ).pathname;
                  const operation = path.startsWith("/rest/v1/")
                    ? path
                        .split("/")
                        .slice(1, path.startsWith("/rest/v1/rpc/") ? 5 : 4)
                        .join("/")
                    : path.startsWith("/auth/")
                      ? "auth"
                      : "storage";
                  console.info("[preview-supabase-timing]", {
                    operation,
                    status,
                    headersMs: Math.round(performance.now() - started),
                  });
                }
              }
            },
          },
        }
      : {}),
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
