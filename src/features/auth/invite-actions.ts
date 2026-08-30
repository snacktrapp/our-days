"use server";

import { headers } from "next/headers";
import {
  clearInvitationIntent,
  readInvitationIntent,
  writeInvitationIntent,
} from "@/lib/auth/invitation-intent.server";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { expireOurDaysAuthCookies } from "@/lib/auth/session-cookies.server";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const OTP = /^\d{6}$/u;
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{40,64}$/u;

export type InviteActionState = Readonly<{
  status: "idle" | "invalid" | "sent" | "accepted" | "denied" | "unavailable";
  message?: string;
  email?: string;
  clearBrowserState?: boolean;
  revision?: number;
}>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

function normalizedEmail(formData: FormData) {
  const value = formData.get("email");
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function clearLocalSession(
  supabase: Awaited<ReturnType<typeof createOurDaysServerClient>>,
) {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The browser-cookie fallback below remains authoritative for this device.
  }
  try {
    await expireOurDaysAuthCookies();
    return true;
  } catch {
    return false;
  }
}

export async function stageInvitationIntent(token: string) {
  if (!(await hasExpectedOrigin()) || !INVITATION_TOKEN.test(token)) {
    await clearInvitationIntent();
    return { ready: false } as const;
  }

  await writeInvitationIntent(token);
  return { ready: true } as const;
}

export async function requestInviteCode(
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const email = normalizedEmail(formData);
  if (!SIMPLE_EMAIL.test(email) || email.length > 254) {
    return { status: "invalid", message: "Enter a complete email address." };
  }
  if (!(await hasExpectedOrigin())) {
    return { status: "denied", message: "This invitation is unavailable." };
  }

  try {
    const invitationToken = await readInvitationIntent();
    if (!invitationToken || !INVITATION_TOKEN.test(invitationToken)) {
      return { status: "denied", message: "This invitation is unavailable." };
    }

    const supabase = await createOurDaysServerClient();
    const { data: invitationMatches, error: preflightError } =
      await supabase.rpc("preflight_invitation", {
        token: invitationToken,
        email,
      });
    if (preflightError || invitationMatches !== true) {
      return {
        status: "sent",
        email,
        message: "If this invitation matches, we sent a six-digit code.",
      };
    }

    const { data: claimsData } = await supabase.auth.getClaims();
    if (typeof claimsData?.claims?.sub === "string") {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: "local",
      });
      if (signOutError) throw signOutError;
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpError) throw otpError;
  } catch {
    // Keep unknown accounts, provider failures, and rate limits indistinguishable.
  }

  return {
    status: "sent",
    email,
    clearBrowserState: true,
    message: "If this invitation matches, we sent a six-digit code.",
  };
}

export async function verifyAndAcceptInvitation(
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const email = normalizedEmail(formData);
  const rawCode = formData.get("code");
  const rawRevision = formData.get("revision");
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const revision =
    typeof rawRevision === "string" && /^\d+$/u.test(rawRevision)
      ? Number(rawRevision)
      : undefined;
  const invitationToken = await readInvitationIntent();

  if (
    !SIMPLE_EMAIL.test(email) ||
    !OTP.test(code) ||
    !invitationToken ||
    !INVITATION_TOKEN.test(invitationToken)
  ) {
    return {
      status: "invalid",
      revision,
      message: "Check the invitation and code.",
    };
  }
  if (!(await hasExpectedOrigin())) {
    return {
      status: "denied",
      revision,
      message: "This invitation is unavailable.",
    };
  }

  let supabase: Awaited<ReturnType<typeof createOurDaysServerClient>> | null =
    null;
  try {
    supabase = await createOurDaysServerClient();
    const { error: verificationError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (verificationError) {
      return {
        status: "denied",
        email,
        revision,
        message:
          "That code is not available. Request a new code and try again.",
      };
    }

    let acceptanceError: { code?: string } | null;
    try {
      ({ error: acceptanceError } = await supabase.rpc("accept_invitation", {
        token: invitationToken,
      }));
    } catch {
      if (!(await clearLocalSession(supabase))) {
        return {
          status: "unavailable",
          email,
          revision,
          message:
            "For safety, clear this site's browser data before continuing.",
        };
      }
      return {
        status: "unavailable",
        email,
        revision,
        message: "Our Days is temporarily unavailable. Please try again.",
      };
    }

    if (acceptanceError) {
      if (!(await clearLocalSession(supabase))) {
        return {
          status: "unavailable",
          email,
          revision,
          message:
            "For safety, clear this site's browser data before continuing.",
        };
      }

      if (acceptanceError.code === "22023") {
        await clearInvitationIntent();
        return {
          status: "denied",
          email,
          revision,
          message: "This invitation or code is no longer available.",
        };
      }

      return {
        status: "unavailable",
        email,
        revision,
        message: "Our Days is temporarily unavailable. Please try again.",
      };
    }
  } catch {
    if (supabase && !(await clearLocalSession(supabase))) {
      return {
        status: "unavailable",
        email,
        revision,
        message:
          "For safety, clear this site's browser data before continuing.",
      };
    }
    return {
      status: "unavailable",
      email,
      revision,
      message: "Our Days is temporarily unavailable. Please try again.",
    };
  }

  await clearInvitationIntent();
  return { status: "accepted", email, revision };
}
