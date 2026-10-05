"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { readJournalAccessState } from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  localJournalIsEnabled,
  resolvedSiteOrigin,
} from "../../../config/our-days-environment";
import { currentTermsVersion, type ReportReason, reportReasons } from "./terms";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SafetyActionResult = Readonly<{
  ok: boolean;
  message: string;
  lastOrganizerCircles?: readonly string[];
}>;

async function originIsExpected() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    resolvedSiteOrigin(),
  );
}

function isReportReason(value: string): value is ReportReason {
  return reportReasons.some(([reason]) => reason === value);
}

export async function readTermsGate() {
  const access = await readJournalAccessState();
  if (access.mode !== "authenticated") return { required: false };
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { readLocalSafety } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) return { required: false };
    const safety = await readLocalSafety(local);
    return { required: safety.termsVersion !== currentTermsVersion };
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("get_my_terms_acceptance");
  if (error) return { required: false };
  const accepted = (data ?? []).some(
    (row) => row.terms_version === currentTermsVersion,
  );
  return { required: !accepted };
}

export async function acceptCurrentTerms(): Promise<SafetyActionResult> {
  if (!(await originIsExpected())) {
    return { ok: false, message: "Terms could not be accepted." };
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { acceptLocalTerms } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) return { ok: false, message: "Terms could not be accepted." };
    await acceptLocalTerms(local, currentTermsVersion);
    revalidatePath("/", "layout");
    return { ok: true, message: "Terms accepted." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("accept_terms", {
    terms_version: currentTermsVersion,
  });
  if (error) return { ok: false, message: "Terms could not be accepted." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Terms accepted." };
}

export async function reportContent(input: {
  targetKind: "moment" | "note";
  targetId: string;
  reason: string;
  details?: string;
}): Promise<SafetyActionResult> {
  if (!(await originIsExpected())) {
    return { ok: false, message: "Content could not be reported." };
  }
  if (
    (input.targetKind !== "moment" && input.targetKind !== "note") ||
    !uuidPattern.test(input.targetId) ||
    !isReportReason(input.reason)
  ) {
    return { ok: false, message: "Content could not be reported." };
  }
  const details = input.details?.trim() ? input.details.trim() : undefined;
  if (details && details.length > 2000) {
    return { ok: false, message: "Content could not be reported." };
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { reportLocalContent } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) return { ok: false, message: "Content could not be reported." };
    await reportLocalContent(local, input.targetKind, input.targetId);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: "Thanks — our team reviews reports within 24 hours.",
    };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("report_content", {
    target_kind: input.targetKind,
    target_id: input.targetId,
    reason: input.reason,
    details,
  });
  if (error) return { ok: false, message: "Content could not be reported." };
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: "Thanks — our team reviews reports within 24 hours.",
  };
}

export async function blockAuthor(
  membershipId: string,
): Promise<SafetyActionResult> {
  if (!(await originIsExpected()) || !uuidPattern.test(membershipId)) {
    return { ok: false, message: "This person cannot be blocked." };
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { blockLocalMember } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) return { ok: false, message: "This person cannot be blocked." };
    try {
      await blockLocalMember(local, membershipId);
    } catch {
      return { ok: false, message: "This person cannot be blocked." };
    }
    revalidatePath("/", "layout");
    return { ok: true, message: "Blocked." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("block_member", {
    target_membership_id: membershipId,
  });
  if (error) return { ok: false, message: "This person cannot be blocked." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Blocked." };
}

export async function unblockAuthor(
  membershipId: string,
): Promise<SafetyActionResult> {
  if (!(await originIsExpected()) || !uuidPattern.test(membershipId)) {
    return { ok: false, message: "This person cannot be unblocked." };
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { unblockLocalMember } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) {
      return { ok: false, message: "This person cannot be unblocked." };
    }
    await unblockLocalMember(local, membershipId);
    revalidatePath("/", "layout");
    return { ok: true, message: "Unblocked." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("unblock_member", {
    target_membership_id: membershipId,
  });
  if (error) return { ok: false, message: "This person cannot be unblocked." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Unblocked." };
}

export type AccountSafetySnapshot = Readonly<{
  blocks: readonly Readonly<{
    membershipId: string;
    personDisplayName: string;
  }>[];
  state: string;
  requestedAt: string | null;
  lastOrganizerCircles: readonly string[];
}>;

export async function loadAccountSafety(): Promise<AccountSafetySnapshot | null> {
  const access = await readJournalAccessState();
  if (access.mode !== "authenticated") return null;
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { readLocalSafety } = await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) return null;
    const safety = await readLocalSafety(local);
    return {
      blocks: safety.blocks.map((block) => ({
        membershipId: block.membershipId,
        personDisplayName: block.personDisplayName,
      })),
      state: safety.deletionRequestedAt ? "requested" : "none",
      requestedAt: safety.deletionRequestedAt,
      lastOrganizerCircles: safety.lastOrganizerCircles,
    };
  }
  const supabase = await createOurDaysServerClient();
  const [blocks, status] = await Promise.all([
    supabase.rpc("list_my_blocks"),
    supabase.rpc("get_my_account_closure_status"),
  ]);
  if (blocks.error || status.error) return null;
  const row = status.data?.[0];
  return {
    blocks: (blocks.data ?? []).map((block) => ({
      membershipId: block.membership_id,
      personDisplayName: block.person_display_name,
    })),
    state: row?.state ?? "none",
    requestedAt: row?.requested_at ?? null,
    lastOrganizerCircles: row?.last_organizer_circles ?? [],
  };
}

export async function requestAccountDeletion(): Promise<SafetyActionResult> {
  if (!(await originIsExpected())) {
    return { ok: false, message: "Account deletion could not be requested." };
  }
  if (localJournalIsEnabled()) {
    const { readLocalJournalAccess } = await import("@/lib/local-journal/auth");
    const { requestLocalAccountDeletion } =
      await import("@/lib/local-journal/store");
    const local = await readLocalJournalAccess();
    if (!local) {
      return { ok: false, message: "Account deletion could not be requested." };
    }
    const result = await requestLocalAccountDeletion(local);
    if (!result.ok) {
      return {
        ok: false,
        message:
          "Every family must retain an active organizer before this account can be deleted.",
        lastOrganizerCircles: result.circles,
      };
    }
    return { ok: true, message: "Deletion requested." };
  }
  const supabase = await createOurDaysServerClient();
  const status = await supabase.rpc("get_my_account_closure_status");
  const circles = status.data?.[0]?.last_organizer_circles ?? [];
  if (circles.length > 0) {
    return {
      ok: false,
      message:
        "Every family must retain an active organizer before this account can be deleted.",
      lastOrganizerCircles: circles,
    };
  }
  const { error } = await supabase.rpc("request_account_closure", {
    request_key: randomUUID(),
  });
  if (error) {
    return { ok: false, message: "Account deletion could not be requested." };
  }
  return { ok: true, message: "Deletion requested." };
}
