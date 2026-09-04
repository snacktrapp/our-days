"use client";

import { useEffect } from "react";
import { completeInvitedSignIn } from "@/features/auth/complete-invited-sign-in";
import { createOurDaysInviteCompletionClient } from "@/lib/supabase/browser";

function hashParams() {
  const hash = window.location.hash.replace(/^#/u, "");
  return new URLSearchParams(hash);
}

function otpType(value: string | null) {
  return value === "invite" ? "invite" : "magiclink";
}

export function CompleteInvitedSession() {
  useEffect(() => {
    const supabase = createOurDaysInviteCompletionClient();
    const params = hashParams();
    const query = new URLSearchParams(window.location.search);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const tokenHash = query.get("token_hash");

    void (async () => {
      if (params.get("error") || params.get("error_description")) {
        window.location.replace("/sign-in?link=invalid");
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          window.location.replace("/sign-in?link=invalid");
          return;
        }
      } else if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: otpType(query.get("type")),
        });
        if (error) {
          window.location.replace("/sign-in?link=invalid");
          return;
        }
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          window.location.replace("/sign-in?link=invalid");
          return;
        }
      }
      await completeInvitedSignIn();
    })();
  }, []);

  return <p>Opening your journal…</p>;
}
