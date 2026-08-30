"use client";

import { useState, useTransition } from "react";
import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import { signOutCurrentDevice } from "./sign-out-action";

export function SignOutButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await signOutCurrentDevice();
            if (!result.ok) {
              setError(
                result.message ?? "We could not sign out. Please try again.",
              );
              return;
            }
            const browserStateCleared = await purgeOurDaysBrowserState();
            window.location.replace(
              browserStateCleared ? "/sign-in" : "/sign-in?cleanup=incomplete",
            );
          });
        }}
      >
        {pending ? "Signing out…" : "Sign out and use another email"}
      </button>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
