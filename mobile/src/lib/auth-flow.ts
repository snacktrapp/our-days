import type { Session, SupabaseClient, SupportedStorage } from "@supabase/supabase-js";

import { validCode, validEmail } from "./journal";

export type AuthResult = Readonly<
  { ok: true; session: Session } | { ok: false; message: string }
>;

type VerifyDeps = Readonly<{
  storage: SupportedStorage;
  storageKey: string;
  /** Test hook. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}>;

const retryDelaysMs = [400, 1200, 2500];

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown; status?: unknown };
    const code = typeof record.code === "string" ? record.code : undefined;
    const status = typeof record.status === "number" ? record.status : undefined;
    const message =
      typeof record.message === "string" ? record.message : String(error);
    return [code, status, message].filter(Boolean).join(" · ");
  }
  return String(error);
}

function verifyMessage(error: { code?: string; message?: string }) {
  if (error.code === "otp_expired") {
    return "That code has expired or was already used. Request a new code and try again.";
  }
  if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "Too many attempts. Wait a minute, then request a new code.";
  }
  return `That code did not work (${describe(error)}). Request a new code and try again.`;
}

/**
 * Password sign-in for the reviewer account (and any other account that has
 * one). The caller passes the same Supabase client as the email-code path,
 * so the session is written to the same chunked secure storage.
 */
export async function signInWithPassword(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();
  if (!validEmail(normalized) || password.length === 0) {
    return { ok: false, message: "Enter your email and password." };
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalized,
      password,
    });
    if (error || !data.session) {
      return { ok: false, message: "That email or password did not work." };
    }
    return { ok: true, session: data.session };
  } catch {
    return { ok: false, message: "That email or password did not work." };
  }
}

/**
 * The email-code sign-in path shared by the app and scripts/e2e-signin.mjs.
 *
 * Only a definitive answer ("this account has no circle") signs the new
 * session out. Transient API failures right after verify are retried and never
 * discard a valid session: a one-off 401 (PGRST303) on the first query after
 * /verify used to trigger signOut and bounce the user back to Sign in.
 */
export async function verifyEmailCode(
  supabase: SupabaseClient,
  email: string,
  code: string,
  deps: VerifyDeps,
): Promise<AuthResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const normalized = email.trim().toLowerCase();
  if (!validEmail(normalized) || !validCode(code)) {
    return { ok: false, message: "Enter your email and the six-digit code." };
  }

  let session: Session | null = null;
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalized,
      token: code.trim(),
      type: "email",
    });
    if (error) return { ok: false, message: verifyMessage(error) };
    session = data.session;
  } catch (error) {
    // auth-js rethrows non-auth errors, including a storage write failure.
    return {
      ok: false,
      message: `Sign-in could not be saved on this device (${describe(error)}).`,
    };
  }
  if (!session) {
    return { ok: false, message: "Sign-in did not return a session. Request a new code." };
  }

  // Prove the session actually round-trips through device storage, so a
  // restart does not silently land on Sign in again.
  try {
    const stored = await deps.storage.getItem(deps.storageKey);
    const parsed = stored ? (JSON.parse(stored) as Partial<Session>) : null;
    if (!parsed || parsed.access_token !== session.access_token) {
      return {
        ok: false,
        message: "Sign-in worked, but this device did not keep the session. Please try again.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      message: `Sign-in worked, but the saved session could not be read (${describe(error)}).`,
    };
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1] ?? 1000);
    const { data, error } = await supabase
      .from("circle_memberships")
      .select("circle_id")
      .limit(2);
    if (!error) {
      if (!data || data.length === 0) {
        await supabase.auth.signOut({ scope: "local" });
        return { ok: false, message: "This account does not have access to a circle." };
      }
      return { ok: true, session };
    }
    lastError = error;
  }

  // Still failing after retries: keep the valid session. The journal screen
  // shows its own load error and retry rather than bouncing to Sign in.
  console.warn(`circle check failed after verify: ${describe(lastError)}`);
  return { ok: true, session };
}
