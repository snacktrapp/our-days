"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { readSupabasePublicConfig } from "@/lib/supabase/public-config";
import {
  invitationDeliveryIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const controlCharacter = /[\u0000-\u001f\u007f]/u;

function readUuid(input: unknown, field: string) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function readRole(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as Record<string, unknown>).role;
  return value === "member" || value === "organizer" ? value : null;
}

function readBoolean(input: unknown, field: string) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "boolean" ? value : null;
}

function readText(input: unknown, field: string) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

export type FamilySettingsActionResult = Readonly<
  { ok: true; message: string } | { ok: false; message: string }
>;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

async function requireOrganizer() {
  if (!(await hasExpectedOrigin())) return null;
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated" || access.role !== "organizer") {
    return null;
  }
  return access;
}

function refreshFamilyAccessSurfaces(personId?: string) {
  revalidatePath("/settings/family");
  revalidatePath("/people");
  revalidatePath("/family");
  if (personId) revalidatePath(`/people/${personId}`);
}

export async function setFamilyMembershipRoleAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  const membershipId = readUuid(input, "membershipId");
  const role = readRole(input);
  if (
    !access ||
    !membershipId ||
    !role ||
    membershipId === access.membershipId
  ) {
    return { ok: false, message: "That role change was not allowed." };
  }
  const supabase = await createOurDaysServerClient();
  const membershipResult = await supabase
    .from("circle_memberships")
    .select("id, person_id, role")
    .eq("id", membershipId)
    .eq("circle_id", access.circleId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipResult.error || !membershipResult.data) {
    return { ok: false, message: "That role change was not allowed." };
  }
  if (membershipResult.data.role === role) {
    refreshFamilyAccessSurfaces(membershipResult.data.person_id);
    return {
      ok: true,
      message:
        role === "organizer"
          ? "That person is already an organizer."
          : "That person is already a family member.",
    };
  }
  const { error } = await supabase.rpc("set_membership_role", {
    membership_id: membershipId,
    role,
  });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "23514"
          ? "This circle must keep at least one organizer."
          : "That role could not be changed. Try again.",
    };
  }
  refreshFamilyAccessSurfaces(membershipResult.data.person_id);
  return {
    ok: true,
    message:
      role === "organizer"
        ? "Organizer access granted."
        : "Organizer access removed.",
  };
}

export async function setManagedProfileGuardianAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  const managedPersonId = readUuid(input, "managedPersonId");
  const guardianMembershipId = readUuid(input, "guardianMembershipId");
  const grantAccess = readBoolean(input, "grantAccess");
  if (
    !access ||
    !managedPersonId ||
    !guardianMembershipId ||
    grantAccess === null
  ) {
    return { ok: false, message: "That journal care change was not allowed." };
  }
  const supabase = await createOurDaysServerClient();
  const [personResult, membershipResult] = await Promise.all([
    supabase
      .from("people")
      .select("id")
      .eq("id", managedPersonId)
      .eq("circle_id", access.circleId)
      .eq("profile_kind", "managed")
      .maybeSingle(),
    supabase
      .from("circle_memberships")
      .select("id")
      .eq("id", guardianMembershipId)
      .eq("circle_id", access.circleId)
      .eq("status", "active")
      .maybeSingle(),
  ]);
  if (
    personResult.error ||
    membershipResult.error ||
    !personResult.data ||
    !membershipResult.data
  ) {
    return { ok: false, message: "That journal care change was not allowed." };
  }
  const { error } = await supabase.rpc("set_person_guardian", {
    managed_person_id: managedPersonId,
    guardian_membership_id: guardianMembershipId,
    grant_access: grantAccess,
  });
  if (error) {
    return {
      ok: false,
      message: "That journal care could not be changed. Try again.",
    };
  }
  refreshFamilyAccessSurfaces(managedPersonId);
  return {
    ok: true,
    message: grantAccess
      ? "Journal guardian assigned."
      : "Journal guardian removed.",
  };
}

export async function revokeFamilyMembershipAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  if (!access) {
    return { ok: false, message: "That access change was not allowed." };
  }
  const membershipId = readUuid(input, "membershipId");
  if (!membershipId || membershipId === access.membershipId) {
    return { ok: false, message: "That access change was not allowed." };
  }
  const supabase = await createOurDaysServerClient();
  const membershipResult = await supabase
    .from("circle_memberships")
    .select("id, person_id, status")
    .eq("id", membershipId)
    .eq("circle_id", access.circleId)
    .maybeSingle();
  if (membershipResult.error || !membershipResult.data) {
    return { ok: false, message: "That access change was not allowed." };
  }
  if (membershipResult.data.status === "revoked") {
    refreshFamilyAccessSurfaces(membershipResult.data.person_id);
    return { ok: true, message: "Family access was already removed." };
  }
  if (membershipResult.data.status !== "active") {
    return { ok: false, message: "That access change was not allowed." };
  }
  const { error } = await supabase.rpc("revoke_membership", {
    membership_id: membershipId,
  });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "23514"
          ? "This circle must keep at least one organizer."
          : "That access could not be removed. Try again.",
    };
  }
  refreshFamilyAccessSurfaces(membershipResult.data.person_id);
  return { ok: true, message: "Family access removed." };
}

export async function requestFamilyInvitationAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  const displayName = readText(input, "displayName")?.trim() ?? "";
  const email = readText(input, "email")?.trim().toLowerCase() ?? "";
  const requestKey = readUuid(input, "requestKey");
  if (
    !access ||
    !invitationDeliveryIsEnabled() ||
    !requestKey ||
    displayName.length < 1 ||
    Array.from(displayName).length > 80 ||
    controlCharacter.test(displayName) ||
    email.length > 254 ||
    !simpleEmail.test(email) ||
    controlCharacter.test(email)
  ) {
    return { ok: false, message: "That invitation could not be sent." };
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("request_invitation_email", {
    circle_id: access.circleId,
    display_name: displayName,
    email,
    request_key: requestKey,
  });
  if (error || typeof data !== "string" || !uuidPattern.test(data)) {
    return {
      ok: false,
      message: "That invitation could not be sent. Try again.",
    };
  }
  if (!(await sendInvitedMagicLink(email))) {
    return {
      ok: false,
      message: "That invitation could not be sent. Try again.",
    };
  }
  revalidatePath("/settings/family");
  return { ok: true, message: "Private invitation requested." };
}

async function sendInvitedMagicLink(email: string) {
  const siteOrigin = resolvedSiteOrigin();
  if (!siteOrigin) return false;
  try {
    const { url, publishableKey } = readSupabasePublicConfig();
    const mailer = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { error } = await mailer.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("/auth/callback", siteOrigin).toString(),
      },
    });
    return !error;
  } catch {
    return false;
  }
}

export async function withdrawFamilyInvitationEmailRequestAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  const emailRequestId = readUuid(input, "emailRequestId");
  if (!access || !emailRequestId) {
    return { ok: false, message: "That invitation change was not allowed." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("withdraw_invitation_email_request", {
    email_request_id: emailRequestId,
  });
  if (error) {
    return {
      ok: false,
      message: "That invitation could not be withdrawn. Try again.",
    };
  }
  revalidatePath("/settings/family");
  return { ok: true, message: "Invitation withdrawn." };
}
