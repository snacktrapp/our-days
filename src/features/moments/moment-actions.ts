"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { AccentToken } from "@/features/accent-token";
import type {
  EditableMomentKind,
  MomentActionResult,
} from "./moment-action-types";
import type {
  MomentConversationViewModel,
  MomentReactionId,
} from "@/features/timeline/timeline-view-model";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const plainDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const accentMap: Readonly<Record<string, AccentToken>> = {
  clay: "clay",
  gold: "ochre",
  plum: "clay",
  rose: "ochre",
  sage: "moss",
  sky: "teal",
};

function mapDatabaseAccent(value: string): AccentToken {
  return accentMap[value] ?? "slate";
}

function validBody(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 4000
  );
}

function validFamilyPayload(input: {
  journalPersonId: unknown;
  kind: unknown;
  title: unknown;
  body: unknown;
  placeName: unknown;
  taggedPersonIds: unknown;
}) {
  if (
    !uuidPattern.test(String(input.journalPersonId)) ||
    !["thought", "milestone", "location"].includes(String(input.kind)) ||
    typeof input.title !== "string" ||
    typeof input.body !== "string" ||
    typeof input.placeName !== "string" ||
    !Array.isArray(input.taggedPersonIds) ||
    input.taggedPersonIds.length > 25 ||
    new Set(input.taggedPersonIds).size !== input.taggedPersonIds.length ||
    input.taggedPersonIds.some(
      (personId) =>
        typeof personId !== "string" ||
        !uuidPattern.test(personId) ||
        personId === input.journalPersonId,
    )
  ) {
    return false;
  }
  const title = input.title.trim();
  const body = input.body.trim();
  const placeName = input.placeName.trim();
  if (body.length > 4000 || title.length > 120 || placeName.length > 160) {
    return false;
  }
  if (input.kind === "thought") return body.length > 0 && title.length === 0;
  if (input.kind === "milestone") return title.length > 0;
  return (
    input.kind === "location" && title.length === 0 && placeName.length > 0
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
  revalidatePath("/memories");
  revalidatePath("/memories/on-this-day");
  revalidatePath("/memories/milestones");
  revalidatePath("/memories/years/[year]", "page");
  if (personId) revalidatePath(`/people/${personId}`);
}

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

export async function createFamilyMomentAction(input: {
  journalPersonId: string;
  kind: EditableMomentKind;
  title: string;
  body: string;
  placeName: string;
  taggedPersonIds: readonly string[];
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
    !validFamilyPayload(input) ||
    !validOccurrence(input.occurredOn, input.occurredAt, input.occurredTimezone)
  ) {
    return { ok: false, message: "Check the moment and try again." };
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("create_family_moment", {
    circle_id: access.circleId,
    journal_person_id: input.journalPersonId,
    moment_kind: input.kind,
    moment_title: input.title.trim(),
    moment_body: input.body.trim(),
    place_name: input.placeName.trim(),
    tagged_person_ids: [...input.taggedPersonIds],
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

export async function updateFamilyMomentAction(input: {
  momentId: string;
  revision: number;
  title: string;
  body: string;
  placeName: string;
  taggedPersonIds: readonly string[];
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
    typeof input.title !== "string" ||
    typeof input.body !== "string" ||
    typeof input.placeName !== "string" ||
    !Array.isArray(input.taggedPersonIds) ||
    input.taggedPersonIds.length > 25 ||
    new Set(input.taggedPersonIds).size !== input.taggedPersonIds.length ||
    input.taggedPersonIds.some(
      (personId) => typeof personId !== "string" || !uuidPattern.test(personId),
    ) ||
    input.title.trim().length > 120 ||
    input.body.trim().length > 4000 ||
    input.placeName.trim().length > 160 ||
    !validOccurrence(input.occurredOn, input.occurredAt, input.occurredTimezone)
  ) {
    return { ok: false, message: "Check the moment and try again." };
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("update_family_moment", {
    moment_id: input.momentId,
    expected_revision: input.revision,
    moment_title: input.title.trim(),
    moment_body: input.body.trim(),
    place_name: input.placeName.trim(),
    tagged_person_ids: [...input.taggedPersonIds],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function displayConversationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function mapConversation(value: {
  notes: unknown;
  reactions: unknown;
}): MomentConversationViewModel {
  const notes = Array.isArray(value.notes)
    ? value.notes.flatMap((note) => {
        if (
          !isRecord(note) ||
          typeof note.id !== "string" ||
          typeof note.authorName !== "string" ||
          typeof note.authorAccent !== "string" ||
          typeof note.body !== "string" ||
          typeof note.createdAt !== "string" ||
          typeof note.revision !== "number" ||
          typeof note.canChange !== "boolean"
        ) {
          return [];
        }
        return [
          {
            id: note.id,
            authorName: note.authorName,
            authorInitial:
              Array.from(note.authorName.trim())[0]?.toLocaleUpperCase(
                "en-US",
              ) ?? "•",
            authorAccent: mapDatabaseAccent(note.authorAccent),
            body: note.body,
            displayDate: displayConversationDate(note.createdAt),
            revision: note.revision,
            canChange: note.canChange,
          },
        ];
      })
    : [];
  const reactionIds = new Set<MomentReactionId>([
    "held-close",
    "made-me-smile",
    "remember-this",
  ]);
  const reactions = Array.isArray(value.reactions)
    ? value.reactions.flatMap((reaction) => {
        if (
          !isRecord(reaction) ||
          typeof reaction.id !== "string" ||
          typeof reaction.personName !== "string" ||
          typeof reaction.personAccent !== "string" ||
          typeof reaction.reactionId !== "string" ||
          !reactionIds.has(reaction.reactionId as MomentReactionId) ||
          typeof reaction.isCurrentMember !== "boolean"
        ) {
          return [];
        }
        return [
          {
            id: reaction.id,
            personName: reaction.personName,
            personInitial:
              Array.from(reaction.personName.trim())[0]?.toLocaleUpperCase(
                "en-US",
              ) ?? "•",
            personAccent: mapDatabaseAccent(reaction.personAccent),
            reactionId: reaction.reactionId as MomentReactionId,
            isCurrentMember: reaction.isCurrentMember,
          },
        ];
      })
    : [];
  return { notes, reactions };
}

export async function loadMomentConversationAction(input: {
  momentId: string;
}) {
  if (!(await hasExpectedOrigin()) || !uuidPattern.test(input.momentId)) {
    return {
      ok: false as const,
      message: "That conversation could not be opened.",
    };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return {
      ok: false as const,
      message: "Preview conversations are not saved.",
    };
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("get_moment_conversation", {
    moment_id: input.momentId,
  });
  const row = data?.[0];
  if (error || !row) {
    return {
      ok: false as const,
      message: "That conversation could not be opened.",
    };
  }
  return {
    ok: true as const,
    conversation: mapConversation({
      notes: row.notes,
      reactions: row.reactions,
    }),
  };
}

export async function createMomentNoteAction(input: {
  momentId: string;
  body: string;
}): Promise<MomentActionResult> {
  if (
    !(await hasExpectedOrigin()) ||
    !uuidPattern.test(input.momentId) ||
    !validBody(input.body) ||
    input.body.trim().length > 1000
  ) {
    return { ok: false, message: "Check the note and try again." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated")
    return { ok: false, message: "Preview notes are not saved." };
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("create_moment_note", {
    moment_id: input.momentId,
    body: input.body.trim(),
  });
  if (error || !data)
    return {
      ok: false,
      message: "That note could not be saved. Your words are still here.",
    };
  return { ok: true, message: "Note saved.", momentId: data };
}

export async function updateMomentNoteAction(input: {
  noteId: string;
  revision: number;
  body: string;
}): Promise<MomentActionResult> {
  if (
    !(await hasExpectedOrigin()) ||
    !uuidPattern.test(input.noteId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1 ||
    !validBody(input.body) ||
    input.body.trim().length > 1000
  ) {
    return { ok: false, message: "Check the note and try again." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated")
    return { ok: false, message: "Preview notes are not changed." };
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("update_moment_note", {
    note_id: input.noteId,
    expected_revision: input.revision,
    body: input.body.trim(),
  });
  if (error)
    return {
      ok: false,
      message:
        error.code === "40001"
          ? "This note changed elsewhere. Reopen it before editing again."
          : "That note could not be changed.",
    };
  return { ok: true, message: "Note updated.", revision: data };
}

export async function trashMomentNoteAction(input: {
  noteId: string;
  revision: number;
}): Promise<MomentActionResult> {
  if (
    !(await hasExpectedOrigin()) ||
    !uuidPattern.test(input.noteId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 1
  ) {
    return { ok: false, message: "That note could not be changed." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated")
    return { ok: false, message: "Preview notes are not changed." };
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("trash_moment_note", {
    note_id: input.noteId,
    expected_revision: input.revision,
  });
  if (error)
    return {
      ok: false,
      message:
        error.code === "40001"
          ? "This note changed elsewhere. Reopen it before trying again."
          : "That note could not be moved to trash.",
    };
  return { ok: true, message: "Note moved to trash.", revision: data };
}

export async function setMomentReactionAction(input: {
  momentId: string;
  reactionId: string | null;
}): Promise<MomentActionResult> {
  const allowed = new Set(["held-close", "made-me-smile", "remember-this"]);
  if (
    !(await hasExpectedOrigin()) ||
    !uuidPattern.test(input.momentId) ||
    (input.reactionId !== null && !allowed.has(input.reactionId))
  ) {
    return { ok: false, message: "That response could not be saved." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated")
    return { ok: false, message: "Preview responses are not saved." };
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("set_moment_reaction", {
    moment_id: input.momentId,
    reaction_type: input.reactionId as string,
  });
  if (error) return { ok: false, message: "That response could not be saved." };
  return {
    ok: true,
    message: input.reactionId ? "Response saved." : "Response removed.",
    revision: data,
  };
}

export async function createWrittenMomentAction(input: {
  journalPersonId: string;
  body: string;
  occurredOn: string;
  occurredAt: string | null;
  occurredTimezone: string | null;
}) {
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
  if (error || !data)
    return {
      ok: false,
      message: "That moment could not be saved. Your draft is still here.",
    };
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
}) {
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
  if (error)
    return {
      ok: false,
      message:
        error.code === "40001"
          ? "This moment changed elsewhere. Reopen it before editing again."
          : "That moment could not be changed.",
    };
  refreshMomentSurfaces();
  return { ok: true, message: "Moment updated.", revision: data };
}
