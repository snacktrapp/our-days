import "server-only";

import { cookies } from "next/headers";
import { readSupabasePublicConfig } from "@/lib/supabase/public-config";

function authCookiePrefix() {
  const { url } = readSupabasePublicConfig();
  const projectReference = new URL(url).hostname.split(".")[0];
  return `sb-${projectReference}-auth-token`;
}

export async function expireOurDaysAuthCookies() {
  const cookieStore = await cookies();
  const prefix = authCookiePrefix();
  for (const { name } of cookieStore.getAll()) {
    if (name !== prefix && !name.startsWith(`${prefix}.`)) continue;
    cookieStore.set(name, "", {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production" ||
        process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
    });
  }
}
