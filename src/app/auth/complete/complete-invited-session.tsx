"use client";

import { useEffect } from "react";
import { completeInvitedSignIn } from "@/features/auth/complete-invited-sign-in";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";

function hashParams() {
  const hash = window.location.hash.replace(/^#/u, "");
  return new URLSearchParams(hash);
}

export function CompleteInvitedSession() {
  useEffect(() => {
    const supabase = createOurDaysBrowserClient();
    const params = hashParams();
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    void (async () => {
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
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
