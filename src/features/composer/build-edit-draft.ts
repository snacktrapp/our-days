import type {
  RemoveMomentPhotoAction,
  ReorderMomentPhotosAction,
  UpdateFamilyMomentAction,
} from "@/features/moments/moment-action-types";
import { photoAlbum } from "@/features/moments/moment-photos";
import type { TimelineMomentViewModel } from "@/features/timeline/timeline-view-model";
import {
  emptyBibleVerseSelection,
  parseBibleVerseMoment,
} from "./bible-verse-catalog";
import type { ComposerEditDraft } from "./moment-composer";
import type { PlaceSelection } from "@/lib/place-coordinates";

function localTimeFor(moment: TimelineMomentViewModel) {
  const instant = moment.editOccurrence?.occurredAt;
  const timeZone = moment.editOccurrence?.timeZone;
  if (!instant || !timeZone) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : "";
}

function placeFromMoment(moment: TimelineMomentViewModel): PlaceSelection {
  return {
    label: moment.placeName ?? (moment.kind === "location" ? moment.place : ""),
    latitude: moment.latitude ?? null,
    longitude: moment.longitude ?? null,
  };
}

export function buildComposerEditDraft(
  moment: TimelineMomentViewModel,
  save: UpdateFamilyMomentAction,
  photoActions?: Readonly<{
    removePhoto?: RemoveMomentPhotoAction;
    reorderPhotos?: ReorderMomentPhotosAction;
  }>,
): ComposerEditDraft | null {
  if (!moment.revision || moment.kind === "insight") return null;
  const parsed =
    moment.kind === "thought" ? parseBibleVerseMoment(moment.text) : null;
  const place = placeFromMoment(moment);
  return {
    momentId: moment.id,
    revision: moment.revision,
    mode: parsed ? "bible-verse" : moment.kind,
    journalPersonId: moment.journalPersonId,
    occurredOn: moment.occurredOn,
    maxOccurredOn: moment.maxOccurredOn ?? moment.occurredOn,
    occurredTime: localTimeFor(moment),
    occurredAt: moment.editOccurrence?.occurredAt ?? null,
    occurredTimezone: moment.editOccurrence?.timeZone ?? null,
    audience: moment.audience === "just_me" ? "just_me" : "family",
    taggedPersonIds: moment.taggedPeople?.map((person) => person.id) ?? [],
    place,
    verseSelection: parsed?.selection ?? emptyBibleVerseSelection,
    title: parsed
      ? parsed.reference
      : moment.kind === "milestone"
        ? moment.milestone
        : moment.kind === "location"
          ? place.label
          : "",
    body: parsed ? parsed.text : moment.text,
    existingMedia:
      moment.kind === "photo"
        ? {
            kind: "photo",
            src: moment.image.src,
            alt: moment.image.alt,
            photos: photoAlbum(moment).map((photo) => ({
              ...(photo.id !== moment.id ? { id: photo.id } : {}),
              src: photo.src,
              alt: photo.alt,
            })),
          }
        : moment.kind === "video"
          ? { kind: "video", src: moment.video.src }
          : undefined,
    save,
    removePhoto: photoActions?.removePhoto,
    reorderPhotos: photoActions?.reorderPhotos,
  };
}
