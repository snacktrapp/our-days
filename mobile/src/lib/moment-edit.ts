/**
 * Edit a post the way the web composer does (src/features/composer/
 * build-edit-draft.ts and the editDraft branch of moment-composer.tsx).
 * Pure functions only, so the e2e script runs them under Node.
 *
 * Revision rule (build 15 heart bug): only `update_family_moment` /
 * `share_private_moment` return the post's revision. Photo removes, reorders
 * and attaches do not touch the post row, and notes, hearts and reactions
 * have revisions of their own. None of those may be written into
 * `moment.revision`.
 */
import {
  emptyBibleVerseSelection,
  formatBibleVerseMoment,
  parseBibleVerseMoment,
  type BibleVerseSelection,
} from "./bible";
import type { MentionSpan } from "./feed-format";
import type { TimelineMoment, TimelinePhoto } from "./journal";
import type { PickedMedia } from "./pick-media";
import type { PlaceSelection } from "./places";

export type EditMode = "photo" | "video" | "thought" | "bible" | "milestone" | "location";

export type EditPhoto = Readonly<{
  key: string;
  /** Set for a photo already on the post. */
  existingPhotoId?: string;
  width?: number;
  height?: number;
  /** Set for a photo picked in this edit. */
  picked?: PickedMedia;
}>;

export type MomentEditDraft = Readonly<{
  mode: EditMode;
  body: string;
  /** Milestone name, location label, or Bible reference. */
  title: string;
  verse: BibleVerseSelection;
  occurredOn: string;
  /** "HH:MM" on a 24-hour clock, or "" for a date-only post. */
  occurredTime: string;
  place: PlaceSelection;
  taggedIds: readonly string[];
  photos: readonly EditPhoto[];
  /** Just me posts only: the circle to share into. Empty keeps Just me. */
  shareToCircleId: string;
}>;

/** Web menu: Edit for every changeable post except an Insight. */
export function canEditMoment(moment: Pick<TimelineMoment, "kind" | "canChange" | "revision">) {
  return moment.canChange && moment.revision >= 1 && moment.kind !== "insight";
}

/** Web `localTimeFor`: the recorded wall clock in the poster's zone. */
export function recordedLocalTime(occurredAt: string | null, timeZone: string | undefined) {
  if (!occurredAt || !timeZone) return "";
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) return "";
  let text: string;
  try {
    // format(), not formatToParts(): Hermes splits parts on punctuation.
    text = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(instant);
  } catch {
    return "";
  }
  const numbers = text.match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 2) return "";
  const [hour, minute] = numbers as [number, number];
  return `${String(hour % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function editModeFor(moment: Pick<TimelineMoment, "kind" | "body">): EditMode | null {
  if (moment.kind === "insight") return null;
  if (moment.kind === "photo" || moment.kind === "video") return moment.kind;
  if (moment.kind === "milestone" || moment.kind === "location") return moment.kind;
  return parseBibleVerseMoment(moment.body) ? "bible" : "thought";
}

/** Web `buildComposerEditDraft`. */
export function buildEditDraft(moment: TimelineMoment): MomentEditDraft | null {
  const mode = editModeFor(moment);
  if (!mode || !canEditMoment(moment)) return null;
  const parsed = mode === "bible" ? parseBibleVerseMoment(moment.body) : null;
  const place: PlaceSelection = {
    label: moment.placeName ?? "",
    latitude: moment.latitude ?? null,
    longitude: moment.longitude ?? null,
  };
  return {
    mode,
    body: parsed ? parsed.text : moment.body,
    title: parsed
      ? parsed.reference
      : mode === "milestone"
        ? moment.title
        : mode === "location"
          ? place.label
          : "",
    verse: parsed?.selection ?? emptyBibleVerseSelection,
    occurredOn: moment.occurredOn,
    occurredTime: recordedLocalTime(moment.occurredAt, moment.occurredTimezone),
    place,
    taggedIds: [...moment.taggedPersonIds],
    photos:
      mode === "photo"
        ? moment.photos.map((photo) => ({
            key: photo.id,
            existingPhotoId: photo.id,
            width: photo.width,
            height: photo.height,
          }))
        : [],
    shareToCircleId: "",
  };
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Web `isDirty` for an edit: any field differs from what the sheet opened with. */
export function editIsDirty(draft: MomentEditDraft, initial: MomentEditDraft) {
  return (
    draft.body !== initial.body ||
    draft.title !== initial.title ||
    draft.verse.book !== initial.verse.book ||
    draft.verse.chapter !== initial.verse.chapter ||
    draft.verse.startVerse !== initial.verse.startVerse ||
    draft.verse.endVerse !== initial.verse.endVerse ||
    draft.place.label !== initial.place.label ||
    draft.place.latitude !== initial.place.latitude ||
    draft.place.longitude !== initial.place.longitude ||
    draft.taggedIds.join(",") !== initial.taggedIds.join(",") ||
    draft.occurredOn !== initial.occurredOn ||
    draft.occurredTime !== initial.occurredTime ||
    draft.shareToCircleId !== initial.shareToCircleId ||
    !sameList(
      draft.photos.map((photo) => photo.key),
      initial.photos.map((photo) => photo.key),
    )
  );
}

/**
 * Web save: an unchanged date and time keeps the recorded instant and zone;
 * a changed one is read on this device's clock, like the web form.
 */
export function editOccurrence(
  draft: Pick<MomentEditDraft, "occurredOn" | "occurredTime">,
  initial: Pick<MomentEditDraft, "occurredOn" | "occurredTime">,
  moment: Pick<TimelineMoment, "occurredAt" | "occurredTimezone">,
  deviceTimeZone: string,
): { occurredAt: string | null; occurredTimezone: string | null } | null {
  if (!draft.occurredTime) return { occurredAt: null, occurredTimezone: null };
  if (
    draft.occurredOn === initial.occurredOn &&
    draft.occurredTime === initial.occurredTime &&
    moment.occurredAt &&
    moment.occurredTimezone
  ) {
    return { occurredAt: moment.occurredAt, occurredTimezone: moment.occurredTimezone };
  }
  const local = new Date(`${draft.occurredOn}T${draft.occurredTime}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return { occurredAt: local.toISOString(), occurredTimezone: deviceTimeZone };
}

/**
 * Web save order for photos: remove what was dropped, reorder the photos that
 * stay (only when more than one), then upload new picks onto the post.
 */
export function photoEditPlan(initial: readonly EditPhoto[], next: readonly EditPhoto[]) {
  const keptIds = next.flatMap((photo) => (photo.existingPhotoId ? [photo.existingPhotoId] : []));
  const removedIds = initial.flatMap((photo) =>
    photo.existingPhotoId && !keptIds.includes(photo.existingPhotoId) ? [photo.existingPhotoId] : [],
  );
  const initialOrder = initial.flatMap((photo) =>
    photo.existingPhotoId && keptIds.includes(photo.existingPhotoId) ? [photo.existingPhotoId] : [],
  );
  return {
    removedIds,
    reorderIds: keptIds.length > 1 && !sameList(keptIds, initialOrder) ? keptIds : null,
    added: next.flatMap((photo) => (photo.picked ? [photo.picked] : [])),
    changed: removedIds.length > 0 || !sameList(keptIds, initialOrder) || next.some((photo) => photo.picked),
  };
}

/** Web `movePhotoItem`. */
export function movePhoto<T>(items: readonly T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Keep caption mentions attached to the same "@Name" text after an edit.
 * Offsets are code points, like the server's char_length. A mention whose
 * text was deleted is dropped. Returns undefined when the post had none, so
 * the save leaves mentions alone.
 */
export function remapMentions(
  before: string,
  after: string,
  mentions: readonly Pick<MentionSpan, "userId" | "start" | "end">[],
) {
  if (mentions.length === 0) return undefined;
  const oldPoints = Array.from(before);
  const newText = after.trim();
  const newPoints = Array.from(newText);
  const used: { start: number; end: number }[] = [];
  const next: { userId: string; start: number; end: number }[] = [];
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    const label = oldPoints.slice(mention.start, mention.end).join("");
    if (!label.startsWith("@")) continue;
    const labelPoints = Array.from(label);
    let found = -1;
    for (let index = 0; index + labelPoints.length <= newPoints.length; index += 1) {
      const end = index + labelPoints.length;
      if (used.some((span) => index < span.end && span.start < end)) continue;
      if (newPoints.slice(index, end).join("") === label) {
        found = index;
        break;
      }
    }
    if (found < 0 || next.some((item) => item.userId === mention.userId)) continue;
    used.push({ start: found, end: found + labelPoints.length });
    next.push({ userId: mention.userId, start: found, end: found + labelPoints.length });
  }
  return next;
}

/** What the save sends as body and title, per web `saveConnectedMoment`. */
export function editPayloadText(draft: MomentEditDraft) {
  const title = draft.title.trim();
  const body = draft.body.trim();
  return {
    title: draft.mode === "milestone" ? title : "",
    body: draft.mode === "bible" ? formatBibleVerseMoment(title, body) : body,
    placeName: draft.mode === "location" ? title : draft.place.label.trim(),
  };
}

/** Web composer checks before any write. Null when the draft can be saved. */
export function editValidationError(draft: MomentEditDraft, initial?: MomentEditDraft) {
  if (draft.shareToCircleId && initial && photoEditPlan(initial.photos, draft.photos).changed) {
    return "Save your photo changes first, then reopen Edit to share this post.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.occurredOn)) return "Check the date and try again.";
  if (draft.mode === "thought" && !draft.body.trim()) return "Write a thought before saving this moment.";
  if (draft.mode === "bible" && (!draft.title.trim() || !draft.body.trim())) return "Select a verse before saving this entry.";
  if (draft.mode === "milestone" && !draft.title.trim()) return "Name the milestone before saving this moment.";
  if (draft.mode === "location" && !draft.title.trim()) return "Name the place before saving this moment.";
  if (draft.mode === "photo" && draft.photos.length === 0) return "Keep at least one photo.";
  return null;
}

/** The card right after Save, before the server answers. */
export function optimisticEditedMoment(
  moment: TimelineMoment,
  draft: MomentEditDraft,
  occurrence: { occurredAt: string | null; occurredTimezone: string | null },
  taggedLabel: string | undefined,
  mentions: readonly { userId: string; start: number; end: number }[] | undefined,
): TimelineMoment {
  const text = editPayloadText(draft);
  const photosById = new Map(moment.photos.map((photo) => [photo.id, photo]));
  const keptPhotos: TimelinePhoto[] = draft.photos.flatMap((photo, index) => {
    const existing = photo.existingPhotoId ? photosById.get(photo.existingPhotoId) : undefined;
    return existing ? [{ ...existing, sortOrder: index }] : [];
  });
  const byUser = new Map(moment.mentions.map((mention) => [mention.userId, mention]));
  return {
    ...moment,
    body: text.body,
    title: text.title,
    placeName: text.placeName || undefined,
    latitude: draft.place.latitude ?? undefined,
    longitude: draft.place.longitude ?? undefined,
    occurredOn: draft.occurredOn,
    occurredAt: occurrence.occurredAt,
    occurredTimezone: occurrence.occurredTimezone ?? undefined,
    timePrecision: occurrence.occurredAt ? "minute" : "date",
    taggedPersonIds: [...draft.taggedIds],
    taggedPeopleLabel: taggedLabel,
    photos: moment.kind === "photo" ? keptPhotos : moment.photos,
    mentions: mentions
      ? mentions.flatMap((mention) => {
          const known = byUser.get(mention.userId);
          return known ? [{ ...known, start: mention.start, end: mention.end }] : [];
        })
      : moment.mentions,
  };
}
