"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { MomentActionResult } from "./moment-action-types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

function validBody(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 4000
  );
}

function validOccurrence(
  occurredOn: unknown,
  occurredAt: unknown,
  occurredTimezone: unknown,
) {
  if (typeof occurredOn !== "string" || !plainDatePattern.test(occurredOn)) {
    return false;
  }
  if (occurredAt === null && occurredTimezone === null) return true;
  if (
    typeof occurredAt !== "string" ||
    typeof occurredTimezone !== "string" ||
    occurredTimezone.length < 1 ||
    occurredTimezone.length > 64
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(occurredAt));
}

function refreshMomentSurfaces(personId?: string) {
  revalidatePath("/family");
  revalidatePath("/people");
  revalidatePath("/people/[personId]", "page");
  revalidatePath("/trash");
  if (personId) revalidatePath(`/people/${personId}`);
}

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

export async function createWrittenMomentAction(input: {
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}): Promise<MomentActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview moments are not saved." };
  }
  if (
    !uuidPattern.test(input.journalPersonId) ||
    !validBody(input.body) ||
    !validOccurrence(input.occurredOn, input.occurredAt, input.occurredTimezone)
  ) {
    return { ok: false, message: "Check the moment and try again." };
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("create_written_moment", {
    circle_id: access.circleId,
    journal_person_id: input.journalPersonId,
    body: input.body.trim(),
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
  });
  if (error || !data) {
    return {
      ok: false,
      message: "That moment could not be saved. Your draft is still here.",
    };
  }
  refreshMomentSurfaces(input.journalPersonId);
  return { ok: true, message: "Moment saved.", momentId: data };
}

export async function updateWrittenMomentAction(input: {
  momentId: string;
  revision: number;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}): Promise<MomentActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview moments are not saved." };
  }
  if (
    !uuidPattern.test(input.momentId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    !validBody(input.body) ||
    !validOccurrence(input.occurredOn, input.occurredAt, input.occurredTimezone)
  ) {
    return { ok: false, message: "Check the moment and try again." };
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("update_written_moment", {
    moment_id: input.momentId,
    expected_revision: input.revision,
    body: input.body.trim(),
    occurred_on: input.occurredOn,
    occurred_at: input.occurredAt ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
  });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "40001"
          ? "This moment changed elsewhere. Reopen it before editing again."
          : "That moment could not be changed.",
    };
  }
  refreshMomentSurfaces();
  return { ok: true, message: "Moment updated.", revision: data };
}

async function setMomentTrashed(
  input: { momentId: string; revision: number },
  trashed: boolean,
): Promise<MomentActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That request could not be verified." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview moments are not changed." };
  }
  if (
    !uuidPattern.test(input.momentId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1
  ) {
    return { ok: false, message: "That moment could not be changed." };
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("set_written_moment_trashed", {
    moment_id: input.momentId,
    expected_revision: input.revision,
    trashed,
  });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "40001"
          ? "This moment changed elsewhere. Refresh before trying again."
          : "That moment could not be changed.",
    };
  }
  refreshMomentSurfaces();
  return {
    ok: true,
    message: trashed ? "Moment moved to trash." : "Moment restored.",
    revision: data,
  };
}

export async function trashWrittenMomentAction(input: {
  momentId: string;
  revision: number;
}) {
  return setMomentTrashed(input, true);
}

export async function restoreWrittenMomentAction(input: {
  momentId: string;
  revision: number;
}) {
  return setMomentTrashed(input, false);
}
