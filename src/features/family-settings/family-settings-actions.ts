"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function readUuid(input: unknown, field: string) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
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

function refreshFamilyAccessSurfaces() {
  revalidatePath("/settings/family");
  revalidatePath("/people");
  revalidatePath("/family");
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
    .select("id")
    .eq("id", membershipId)
    .eq("circle_id", access.circleId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipResult.error || !membershipResult.data) {
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
  refreshFamilyAccessSurfaces();
  return { ok: true, message: "Family access removed." };
}

export async function revokeFamilyInvitationAction(
  input: unknown,
): Promise<FamilySettingsActionResult> {
  const access = await requireOrganizer();
  const invitationId = readUuid(input, "invitationId");
  if (!access || !invitationId) {
    return { ok: false, message: "That invitation change was not allowed." };
  }
  const supabase = await createOurDaysServerClient();
  const pendingResult = await supabase.rpc("list_pending_invitations", {
    circle_id: access.circleId,
  });
  if (
    pendingResult.error ||
    !(pendingResult.data ?? []).some(
      (invitation) => invitation.invitation_id === invitationId,
    )
  ) {
    return { ok: false, message: "That invitation change was not allowed." };
  }
  const { error } = await supabase.rpc("revoke_invitation", {
    invitation_id: invitationId,
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
