"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const OTP = /^\d{6}$/u;

export type SignInActionState = Readonly<{
  status: "idle" | "invalid" | "sent" | "denied" | "no-access" | "unavailable";
  message?: string;
  email?: string;
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

export async function requestSignInCode(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const email = normalizedEmail(formData);
  if (!SIMPLE_EMAIL.test(email) || email.length > 254) {
    return { status: "invalid", message: "Enter a complete email address." };
  }
  if (!(await hasExpectedOrigin())) {
    return { status: "denied", message: "Sign-in is unavailable right now." };
  }

  try {
    const supabase = await createOurDaysServerClient();
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
  } catch {
    // The response stays deliberately identical for unknown addresses,
    // provider failures, and rate limits so the form is not an account oracle.
  }

  return {
    status: "sent",
    email,
    message: "If this address has access, we sent a six-digit code.",
  };
}

export async function verifySignInCode(
  _previousState: SignInActionState,
  formData: FormData,
): Promise<SignInActionState> {
  const email = normalizedEmail(formData);
  const rawCode = formData.get("code");
  const code = typeof rawCode === "string" ? rawCode.trim() : "";

  if (!SIMPLE_EMAIL.test(email) || !OTP.test(code)) {
    return { status: "invalid", message: "Enter the six-digit code." };
  }
  if (!(await hasExpectedOrigin())) {
    return { status: "denied", message: "Sign-in is unavailable right now." };
  }

  try {
    const supabase = await createOurDaysServerClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error) {
      return {
        status: "denied",
        email,
        message:
          "That code is not available. Request a new code and try again.",
      };
    }

    const { data, error: membershipError } = await supabase
      .from("circle_memberships")
      .select("circle_id")
      .limit(2);
    if (membershipError) {
      await supabase.auth.signOut({ scope: "local" });
      return {
        status: "unavailable",
        email,
        message: "Our Days is temporarily unavailable. Please try again.",
      };
    }

    if (!data || data.length === 0) {
      return {
        status: "no-access",
        email,
        message: "This account does not have access to a family circle.",
      };
    }
  } catch {
    return {
      status: "unavailable",
      email,
      message: "Our Days is temporarily unavailable. Please try again.",
    };
  }

  redirect("/family");
}
