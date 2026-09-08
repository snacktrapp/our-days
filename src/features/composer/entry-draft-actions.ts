"use server";

import { headers } from "next/headers";
import { localJournalIsEnabled } from "../../../config/our-days-environment";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isExpectedMutationOrigin } from "@/lib/auth/same-origin";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import { emptyBibleVerseSelection } from "./bible-verse-catalog";
import {
  entryDraftCapMessage,
  isEntryDraftKind,
  type EntryDraftActionResult,
  type EntryDraftListItem,
  type EntryDraftMediaRef,
  type EntryDraftRecord,
  type SaveEntryDraftInput,
} from "./entry-drafts";
import { normalizeMomentAudience } from "@/features/moments/moment-audience";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function hasExpectedOrigin() {
  const requestHeaders = await headers();
  return isExpectedMutationOrigin(
    requestHeaders.get("origin"),
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

function parseMedia(value: unknown): EntryDraftMediaRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string") return [];
    if (row.kind !== "photo" && row.kind !== "video") return [];
    return [
      {
        key: row.key,
        kind: row.kind,
        name: typeof row.name === "string" ? row.name : "media",
        mimeType:
          typeof row.mimeType === "string"
            ? row.mimeType
            : "application/octet-stream",
        size: typeof row.size === "number" ? row.size : 0,
      },
    ];
  });
}

function parseVerse(value: unknown) {
  if (!value || typeof value !== "object") return emptyBibleVerseSelection;
  const row = value as Record<string, unknown>;
  return {
    book: typeof row.book === "string" ? row.book : null,
    chapter: typeof row.chapter === "number" ? row.chapter : null,
    startVerse: typeof row.startVerse === "number" ? row.startVerse : null,
    endVerse: typeof row.endVerse === "number" ? row.endVerse : null,
  };
}

async function localDraftStore() {
  return import("@/lib/local-journal/store");
}

export async function listEntryDraftsAction(): Promise<
  readonly EntryDraftListItem[]
> {
  if (!(await hasExpectedOrigin())) return [];
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") return [];
  if (localJournalIsEnabled()) {
    const { listLocalEntryDrafts } = await localDraftStore();
    return listLocalEntryDrafts(access);
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("list_entry_drafts");
  if (error || !data) return [];
  return data.flatMap((row) => {
    if (!isEntryDraftKind(row.kind)) return [];
    return [
      {
        id: row.draft_id,
        kind: row.kind,
        previewText: row.preview_text,
        updatedAt: row.updated_at,
      },
    ];
  });
}

export async function loadEntryDraftAction(
  id: string,
): Promise<EntryDraftRecord | null> {
  if (!(await hasExpectedOrigin()) || !uuidPattern.test(id)) return null;
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") return null;
  if (localJournalIsEnabled()) {
    const { loadLocalEntryDraft } = await localDraftStore();
    return loadLocalEntryDraft(access, id);
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("get_entry_draft", {
    draft_id: id,
  });
  const row = data?.[0];
  if (error || !row || !isEntryDraftKind(row.kind)) return null;
  return {
    id: row.draft_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    audience: normalizeMomentAudience(row.audience),
    circleIds: row.circle_ids ?? [],
    journalPersonId: row.journal_person_id,
    taggedPersonIds: row.tagged_person_ids ?? [],
    place: {
      label: row.place_name,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    occurredOn: row.occurred_on,
    occurredTime: row.occurred_time,
    occurredTimezone: row.occurred_timezone,
    media: parseMedia(row.media),
    verse: parseVerse(row.verse),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveEntryDraftAction(
  input: SaveEntryDraftInput,
): Promise<EntryDraftActionResult> {
  if (!(await hasExpectedOrigin())) {
    return { ok: false, message: "That request could not be verified." };
  }
  if (!isEntryDraftKind(input.kind)) {
    return { ok: false, message: "That draft could not be saved." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "Preview drafts stay on this device." };
  }
  if (localJournalIsEnabled()) {
    const { saveLocalEntryDraft } = await localDraftStore();
    try {
      const id = await saveLocalEntryDraft(access, input);
      return { ok: true, message: "Draft saved.", id };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "That draft could not be saved.",
      };
    }
  }
  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase.rpc("save_entry_draft", {
    draft_id: input.id ?? undefined,
    kind: input.kind,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 4000),
    audience: input.audience,
    circle_ids: [...input.circleIds],
    journal_person_id: input.journalPersonId ?? undefined,
    tagged_person_ids: [...input.taggedPersonIds],
    place_name: input.place.label.slice(0, 200),
    latitude: input.place.latitude,
    longitude: input.place.longitude,
    occurred_on: input.occurredOn ?? undefined,
    occurred_time: input.occurredTime ?? undefined,
    occurred_timezone: input.occurredTimezone ?? undefined,
    media: [...input.media],
    verse: input.verse,
  });
  if (error) {
    const message = error.message.includes("Delete a draft first")
      ? entryDraftCapMessage
      : "That draft could not be saved.";
    return { ok: false, message };
  }
  if (!data) return { ok: false, message: "That draft could not be saved." };
  return { ok: true, message: "Draft saved.", id: data };
}

export async function deleteEntryDraftAction(
  id: string,
): Promise<EntryDraftActionResult> {
  if (!(await hasExpectedOrigin()) || !uuidPattern.test(id)) {
    return { ok: false, message: "That draft could not be deleted." };
  }
  const access = await requireJournalAccess();
  if (access.mode !== "authenticated") {
    return { ok: false, message: "That draft could not be deleted." };
  }
  if (localJournalIsEnabled()) {
    const { deleteLocalEntryDraft } = await localDraftStore();
    await deleteLocalEntryDraft(access, id);
    return { ok: true, message: "Draft deleted." };
  }
  const supabase = await createOurDaysServerClient();
  const { error } = await supabase.rpc("delete_entry_draft", { draft_id: id });
  if (error) return { ok: false, message: "That draft could not be deleted." };
  return { ok: true, message: "Draft deleted." };
}
