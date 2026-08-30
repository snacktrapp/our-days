import "server-only";

import { cookies } from "next/headers";

const INVITATION_INTENT_COOKIE = "our-days-invitation-intent";
const INVITATION_INTENT_SECONDS = 10 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    maxAge: INVITATION_INTENT_SECONDS,
    path: "/invite",
    sameSite: "strict" as const,
    secure:
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://") === true,
  };
}

export async function readInvitationIntent() {
  return (await cookies()).get(INVITATION_INTENT_COOKIE)?.value ?? null;
}

export async function writeInvitationIntent(token: string) {
  (await cookies()).set(INVITATION_INTENT_COOKIE, token, cookieOptions());
}

export async function clearInvitationIntent() {
  (await cookies()).set(INVITATION_INTENT_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}
