import { emptyBibleVerseSelection } from "./bible-verse-catalog";
import {
  entryDraftCapMessage,
  entryDraftPreviewText,
  isEntryDraftKind,
  maximumEntryDrafts,
  type EntryDraftActions,
  type EntryDraftListItem,
  type EntryDraftRecord,
  type SaveEntryDraftInput,
} from "./entry-drafts";
import { emptyPlaceSelection } from "@/lib/place-coordinates";
import { normalizeMomentAudience } from "@/features/moments/moment-audience";

const storageKey = "our-days:preview-drafts";

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `preview-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStored(): EntryDraftRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      const record = parseRecord(row);
      return record ? [record] : [];
    });
  } catch {
    return [];
  }
}

function writeStored(records: readonly EntryDraftRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(records));
}

function parseRecord(value: unknown): EntryDraftRecord | null {
  if (!isRecord(value) || !isEntryDraftKind(value.kind)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  const place = isRecord(value.place)
    ? {
        label: typeof value.place.label === "string" ? value.place.label : "",
        latitude:
          typeof value.place.latitude === "number"
            ? value.place.latitude
            : null,
        longitude:
          typeof value.place.longitude === "number"
            ? value.place.longitude
            : null,
      }
    : emptyPlaceSelection();
  const verse = isRecord(value.verse)
    ? {
        book: typeof value.verse.book === "string" ? value.verse.book : null,
        chapter:
          typeof value.verse.chapter === "number" ? value.verse.chapter : null,
        startVerse:
          typeof value.verse.startVerse === "number"
            ? value.verse.startVerse
            : null,
        endVerse:
          typeof value.verse.endVerse === "number"
            ? value.verse.endVerse
            : null,
      }
    : emptyBibleVerseSelection;
  return {
    id: value.id,
    kind: value.kind,
    title: typeof value.title === "string" ? value.title : "",
    body: typeof value.body === "string" ? value.body : "",
    audience: normalizeMomentAudience(value.audience),
    circleIds: Array.isArray(value.circleIds)
      ? value.circleIds.filter((id): id is string => typeof id === "string")
      : [],
    journalPersonId:
      typeof value.journalPersonId === "string" ? value.journalPersonId : null,
    taggedPersonIds: Array.isArray(value.taggedPersonIds)
      ? value.taggedPersonIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    place,
    occurredOn: typeof value.occurredOn === "string" ? value.occurredOn : null,
    occurredTime:
      typeof value.occurredTime === "string" ? value.occurredTime : null,
    occurredTimezone:
      typeof value.occurredTimezone === "string"
        ? value.occurredTimezone
        : null,
    media: Array.isArray(value.media)
      ? value.media.flatMap((item) => {
          if (!isRecord(item) || typeof item.key !== "string") return [];
          if (item.kind !== "photo" && item.kind !== "video") return [];
          return [
            {
              key: item.key,
              kind: item.kind,
              name: typeof item.name === "string" ? item.name : "media",
              mimeType:
                typeof item.mimeType === "string"
                  ? item.mimeType
                  : "application/octet-stream",
              size: typeof item.size === "number" ? item.size : 0,
            },
          ];
        })
      : [],
    verse,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : nowIso(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : nowIso(),
  };
}

function toListItem(record: EntryDraftRecord): EntryDraftListItem {
  return {
    id: record.id,
    kind: record.kind,
    previewText: entryDraftPreviewText({
      title: record.title,
      body: record.body,
      mediaCount: record.media.length,
    }),
    updatedAt: record.updatedAt,
  };
}

export function resetPreviewEntryDrafts() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(storageKey);
  }
}

export function createPreviewEntryDraftActions(): EntryDraftActions {
  return {
    async list() {
      return readStored()
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(toListItem);
    },
    async load(id) {
      return readStored().find((draft) => draft.id === id) ?? null;
    },
    async save(input: SaveEntryDraftInput) {
      const current = readStored();
      const existing = input.id
        ? current.find((draft) => draft.id === input.id)
        : undefined;
      if (!existing && current.length >= maximumEntryDrafts) {
        return { ok: false, message: entryDraftCapMessage };
      }
      const now = nowIso();
      const next: EntryDraftRecord = {
        id: existing?.id ?? input.id ?? newId(),
        kind: input.kind,
        title: input.title,
        body: input.body,
        audience: input.audience,
        circleIds: input.circleIds,
        journalPersonId: input.journalPersonId,
        taggedPersonIds: input.taggedPersonIds,
        place: input.place,
        occurredOn: input.occurredOn,
        occurredTime: input.occurredTime,
        occurredTimezone: input.occurredTimezone,
        media: input.media,
        verse: input.verse,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      writeStored([next, ...current.filter((draft) => draft.id !== next.id)]);
      return { ok: true, message: "Draft saved.", id: next.id };
    },
    async remove(id) {
      writeStored(readStored().filter((draft) => draft.id !== id));
      return { ok: true, message: "Draft deleted." };
    },
  };
}
