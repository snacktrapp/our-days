import type { MomentAudience } from "@/features/moments/moment-audience";
import type { PlaceSelection } from "@/lib/place-coordinates";
import type { BibleVerseSelection } from "./bible-verse-catalog";

export const maximumEntryDrafts = 20;

export const entryDraftKinds = [
  "thought",
  "photo",
  "video",
  "bible-verse",
  "daily-prayer",
  "milestone",
  "location",
] as const;

export type EntryDraftKind = (typeof entryDraftKinds)[number];

export type EntryDraftMediaRef = Readonly<{
  key: string;
  kind: "photo" | "video";
  name: string;
  mimeType: string;
  size: number;
}>;

export type EntryDraftRecord = Readonly<{
  id: string;
  kind: EntryDraftKind;
  title: string;
  body: string;
  audience: MomentAudience;
  circleIds: readonly string[];
  journalPersonId: string | null;
  taggedPersonIds: readonly string[];
  place: PlaceSelection;
  occurredOn: string | null;
  occurredTime: string | null;
  occurredTimezone: string | null;
  media: readonly EntryDraftMediaRef[];
  verse: BibleVerseSelection;
  createdAt: string;
  updatedAt: string;
}>;

export type EntryDraftListItem = Readonly<{
  id: string;
  kind: EntryDraftKind;
  previewText: string;
  updatedAt: string;
}>;

export type SaveEntryDraftInput = Readonly<{
  id?: string;
  kind: EntryDraftKind;
  title: string;
  body: string;
  audience: MomentAudience;
  circleIds: readonly string[];
  journalPersonId: string | null;
  taggedPersonIds: readonly string[];
  place: PlaceSelection;
  occurredOn: string | null;
  occurredTime: string | null;
  occurredTimezone: string | null;
  media: readonly EntryDraftMediaRef[];
  verse: BibleVerseSelection;
}>;

export type EntryDraftActionResult = Readonly<{
  ok: boolean;
  message: string;
  id?: string;
}>;

export type EntryDraftActions = Readonly<{
  list: () => Promise<readonly EntryDraftListItem[]>;
  load: (id: string) => Promise<EntryDraftRecord | null>;
  save: (input: SaveEntryDraftInput) => Promise<EntryDraftActionResult>;
  remove: (id: string) => Promise<EntryDraftActionResult>;
}>;

const kindLabels: Readonly<Record<EntryDraftKind, string>> = {
  thought: "Note",
  photo: "Photo",
  video: "Video",
  "bible-verse": "Bible verse",
  "daily-prayer": "Daily prayer",
  milestone: "Milestone",
  location: "Location",
};

export function entryDraftKindLabel(kind: EntryDraftKind) {
  return kindLabels[kind];
}

export function isEntryDraftKind(value: unknown): value is EntryDraftKind {
  return (
    typeof value === "string" &&
    (entryDraftKinds as readonly string[]).includes(value)
  );
}

export function entryDraftPreviewText(input: {
  title?: string | null;
  body?: string | null;
  mediaCount?: number;
}) {
  const title = input.title?.trim() ?? "";
  if (title) return title.slice(0, 80);
  const body = input.body?.trim() ?? "";
  if (body) return body.slice(0, 80);
  if ((input.mediaCount ?? 0) > 0) return "Media attached";
  return "";
}

export function formatEntryDraftSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatEntryDraftRowLabel(
  kind: EntryDraftKind,
  updatedAt: string,
) {
  return `${entryDraftKindLabel(kind)} · ${formatEntryDraftSavedAt(updatedAt)}`;
}

export const entryDraftCapMessage =
  "Delete a draft first. You can keep up to 20.";
