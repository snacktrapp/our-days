import { NextResponse } from "next/server";
import { acceptPendingInvitationForSession } from "@/lib/auth/accept-pending-invitation.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

function appRedirect(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  if (!code && !tokenHash) {
    // Implicit invite tokens live in the URL hash, which this route never
    // sees. Hand the browser to the client completer; it keeps the hash.
    return appRedirect(request, "/auth/complete");
  }

  try {
    const supabase = await createOurDaysServerClient();
    const { error: exchangeError } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({
          token_hash: tokenHash!,
          type: otpType === "invite" ? "invite" : "magiclink",
        });

    if (exchangeError) {
      return appRedirect(request, "/sign-in?link=invalid");
    }

    const { data, error: membershipError } = await supabase
      .from("circle_memberships")
      .select("circle_id")
      .limit(2);

    if (membershipError) {
      await supabase.auth.signOut({ scope: "local" });
      return appRedirect(request, "/sign-in?link=unavailable");
    }

    if (!data || data.length === 0) {
      const accepted = await acceptPendingInvitationForSession(supabase);
      if (!accepted) {
        return appRedirect(request, "/access-unavailable");
      }
    }

    return appRedirect(request, "/family");
  } catch {
    return appRedirect(request, "/sign-in?link=unavailable");
  }
}
