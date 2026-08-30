"use server";

import { headers } from "next/headers";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { expireOurDaysAuthCookies } from "@/lib/auth/session-cookies.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

export type SignOutResult = Readonly<{
  ok: boolean;
  message?: string;
}>;

export async function signOutCurrentDevice(): Promise<SignOutResult> {
  const requestHeaders = await headers();
  if (
    !isExpectedMutationOrigin(
      requestHeaders.get("origin"),
      process.env.NEXT_PUBLIC_SITE_URL,
    )
  ) {
    return { ok: false, message: "Sign out could not be verified." };
  }

  try {
    const supabase = await createOurDaysServerClient();
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      await expireOurDaysAuthCookies();
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "We could not sign out this device. Please try again.",
    };
  }
}
