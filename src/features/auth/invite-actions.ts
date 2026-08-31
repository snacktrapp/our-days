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
const MEMBERSHIP_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type InviteActionState = Readonly<{
  status: "idle" | "invalid" | "accepted" | "denied" | "unavailable";
  message?: string;
  email?: string;
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

async function verifyInvitationAuthenticationCode(
  supabase: Awaited<ReturnType<typeof createOurDaysServerClient>>,
  email: string,
  code: string,
) {
  const inviteResult = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "invite",
  });
  if (!inviteResult.error) return null;

  const emailResult = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });
  return emailResult.error;
}

export async function stageInvitationIntent(token: string) {
  if (!(await hasExpectedOrigin()) || !INVITATION_TOKEN.test(token)) {
    await clearInvitationIntent();
    return { ready: false } as const;
  }

  await writeInvitationIntent(token);
  return { ready: true } as const;
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
    if (!(await clearLocalSession(supabase))) {
      return {
        status: "unavailable",
        email,
        revision,
        message:
          "For safety, clear this site's browser data before continuing.",
      };
    }
    const verificationError = await verifyInvitationAuthenticationCode(
      supabase,
      email,
      code,
    );
    if (verificationError) {
      return {
        status: "denied",
        email,
        revision,
        message:
          "That invitation code is not available. Check both fields or ask your organizer for a fresh invitation.",
      };
    }

    let membershipId: unknown;
    let acceptanceError: { code?: string } | null;
    try {
      ({ data: membershipId, error: acceptanceError } = await supabase.rpc(
        "accept_invitation",
        { token: invitationToken },
      ));
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

    if (acceptanceError || !MEMBERSHIP_ID.test(String(membershipId))) {
      if (!(await clearLocalSession(supabase))) {
        return {
          status: "unavailable",
          email,
          revision,
          message:
            "For safety, clear this site's browser data before continuing.",
        };
      }

      if (!acceptanceError || acceptanceError.code === "22023") {
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
