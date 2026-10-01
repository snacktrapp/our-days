import type { SupabaseClient } from "@supabase/supabase-js";

function newRequestKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const tokenPattern = /^[A-Za-z0-9_-]{40,64}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const codePattern = /^\d{6}$/u;

/** Token from `/invite#…`, `/invite?token=`, or `ourdays://invite?token=`. */
export function invitationTokenFromLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (tokenPattern.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const query = url.searchParams.get("token");
    if (query && tokenPattern.test(query)) return query;
    const hash = url.hash.replace(/^#/u, "");
    if (tokenPattern.test(hash)) return hash;
  } catch {
    return null;
  }
  return null;
}

export function validInvitationEmail(value: string) {
  const email = value.trim().toLowerCase();
  return emailPattern.test(email) && email.length <= 254;
}

export function validInvitationCode(value: string) {
  return codePattern.test(value.trim());
}

/** Same RPC the web uses from Invite someone. The worker sends the email. */
export async function requestCircleInvitation(
  supabase: SupabaseClient,
  input: Readonly<{ circleId: string; displayName: string; email: string }>,
) {
  const displayName = input.displayName.trim();
  const email = input.email.trim().toLowerCase();
  if (!input.circleId || displayName.length < 1 || displayName.length > 80 || !validInvitationEmail(email)) {
    return { ok: false as const, message: "That invitation could not be sent." };
  }
  const requestKey = newRequestKey();
  const { data, error } = await supabase.rpc("request_invitation_email", {
    circle_id: input.circleId,
    email,
    display_name: displayName,
    request_key: requestKey,
  });
  const queued = typeof data === "string" && data.length > 0;
  const alreadyQueued = !queued && error?.code === "22023";
  if (!queued && !alreadyQueued) {
    return { ok: false as const, message: "That invitation could not be sent. Try again." };
  }
  return { ok: true as const, message: "Private invitation requested." };
}

/**
 * Web invite entry: verify the email code (invite, then email), then
 * accept_invitation with the link token.
 */
export async function acceptCircleInvitation(
  supabase: SupabaseClient,
  input: Readonly<{ email: string; code: string; token: string }>,
) {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();
  const token = invitationTokenFromLink(input.token) ?? "";
  if (!validInvitationEmail(email) || !validInvitationCode(code) || !token) {
    return { ok: false as const, message: "Check the invitation and code." };
  }
  const invite = await supabase.auth.verifyOtp({ email, token: code, type: "invite" });
  if (invite.error) {
    const fallback = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (fallback.error || !fallback.data.session) {
      return {
        ok: false as const,
        message:
          "That invitation code is not available. Check both fields or ask your organizer for a fresh invitation.",
      };
    }
  }
  const { data, error } = await supabase.rpc("accept_invitation", { token });
  if (error || typeof data !== "string") {
    return {
      ok: false as const,
      message: "This invitation or code is no longer available.",
    };
  }
  return { ok: true as const, message: "You’re in the circle.", membershipId: data };
}
