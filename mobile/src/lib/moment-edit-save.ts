import type { SupabaseClient } from "@supabase/supabase-js";

import type { TimelineMoment } from "./journal";
import {
  editOccurrence,
  editPayloadText,
  editValidationError,
  optimisticEditedMoment,
  photoEditPlan,
  remapMentions,
  type MomentEditDraft,
} from "./moment-edit";
import { queueAddPhotos, settlePending } from "./pending-uploads";
import {
  removeMomentPhoto,
  reorderMomentPhotos,
  sharePrivateMoment,
  updateFamilyMoment,
  type FamilyMomentEdit,
} from "./posts";

export type EditSaveResult =
  | Readonly<{
      ok: true;
      /** The post's new revision from update_family_moment / share_private_moment. */
      revision: number;
      occurredAt: string | null;
      occurredTimezone: string | null;
      mentions: readonly { userId: string; start: number; end: number }[] | undefined;
      /**
       * New photos still uploading (shown on the card as pending pages);
       * resolves when they are on the post. A failure stays on the card with Retry.
       */
      adding: Promise<{ ok: boolean; message?: string; jobId: string }> | null;
    }>
  | Readonly<{
      ok: false;
      message: string;
      conflict: boolean;
      /** Set when the text saved but a photo step failed: the card must take this revision. */
      revision?: number;
    }>;

/** Everything a Save sends, in the web composer's order. */
export function editWrite(
  moment: TimelineMoment,
  initial: MomentEditDraft,
  draft: MomentEditDraft,
  deviceTimeZone: string,
):
  | Readonly<{ ok: true; edit: FamilyMomentEdit }>
  | Readonly<{ ok: false; message: string }> {
  const invalid = editValidationError(draft, initial);
  if (invalid) return { ok: false, message: invalid };
  const occurrence = editOccurrence(draft, initial, moment, deviceTimeZone);
  if (!occurrence) return { ok: false, message: "Check the time and try again." };
  const text = editPayloadText(draft);
  const justMe = moment.audience === "just_me" && !draft.shareToCircleId;
  return {
    ok: true,
    edit: {
      momentId: moment.id,
      revision: moment.revision,
      title: text.title,
      body: text.body,
      placeName: text.placeName,
      latitude: draft.place.latitude,
      longitude: draft.place.longitude,
      taggedPersonIds: draft.taggedIds,
      occurredOn: draft.occurredOn,
      occurredAt: occurrence.occurredAt,
      occurredTimezone: occurrence.occurredTimezone,
      audience: moment.audience === "just_me" ? "just_me" : "family",
      // Web sends [] for Just me and Bible verses; otherwise keep each @Name attached.
      mentions:
        justMe || draft.mode === "bible"
          ? moment.mentions.length > 0
            ? []
            : undefined
          : remapMentions(moment.body, text.body, moment.mentions),
    },
  };
}

export async function saveMomentEdit(
  supabase: SupabaseClient,
  input: Readonly<{
    moment: TimelineMoment;
    initial: MomentEditDraft;
    draft: MomentEditDraft;
    deviceTimeZone: string;
  }>,
): Promise<EditSaveResult> {
  const { moment, initial, draft } = input;
  const write = editWrite(moment, initial, draft, input.deviceTimeZone);
  if (!write.ok) return { ok: false, message: write.message, conflict: false };
  const saved = draft.shareToCircleId
    ? await sharePrivateMoment(supabase, { ...write.edit, destinationCircleId: draft.shareToCircleId })
    : await updateFamilyMoment(supabase, write.edit);
  if (!saved.ok) return { ok: false, message: saved.message, conflict: saved.conflict };
  const revision = saved.revision;
  const plan = moment.kind === "photo" ? photoEditPlan(initial.photos, draft.photos) : null;
  try {
    for (const photoId of plan?.removedIds ?? []) {
      const removed = await removeMomentPhoto(supabase, moment.id, photoId);
      if (!removed.ok) return { ok: false, message: removed.message, conflict: false, revision };
    }
    if (plan?.reorderIds) {
      const reordered = await reorderMomentPhotos(supabase, moment.id, plan.reorderIds);
      if (!reordered.ok) return { ok: false, message: reordered.message, conflict: false, revision };
    }
  } catch {
    return {
      ok: false,
      message: "The moment was saved, but photos still need attention. Try again.",
      conflict: false,
      revision,
    };
  }
  const added = plan?.added ?? [];
  return {
    ok: true,
    revision,
    occurredAt: write.edit.occurredAt,
    occurredTimezone: write.edit.occurredTimezone,
    mentions: write.edit.mentions,
    adding:
      added.length > 0
        ? queueAddPhotos(
            supabase,
            {
              id: moment.id,
              circleId: moment.circleId,
              journalPersonId: moment.journalPersonId,
              occurredOn: draft.occurredOn,
              audience: moment.audience,
            },
            added,
          ).then(async ({ id, done }) => {
            const job = await done;
            return { ok: job?.state === "done", message: job?.error ?? undefined, jobId: id };
          })
        : null,
  };
}

/** Card fields an edit can change. Conversation, hearts and the rest stay as they are. */
function editedFields(moment: TimelineMoment) {
  return {
    body: moment.body,
    title: moment.title,
    placeName: moment.placeName,
    latitude: moment.latitude,
    longitude: moment.longitude,
    occurredOn: moment.occurredOn,
    occurredAt: moment.occurredAt,
    occurredTimezone: moment.occurredTimezone,
    timePrecision: moment.timePrecision,
    taggedPersonIds: moment.taggedPersonIds,
    taggedPeopleLabel: moment.taggedPeopleLabel,
    photos: moment.photos,
    mentions: moment.mentions,
    audience: moment.audience,
    linkedCircleIds: moment.linkedCircleIds,
  } satisfies Partial<TimelineMoment>;
}

export type EditReopen = Readonly<{
  moment: TimelineMoment;
  draft?: MomentEditDraft;
  error: string;
}>;

/**
 * Optimistic edit: the card shows the change at once and the sheet closes.
 * On failure the card goes back and the sheet reopens with the user's draft
 * and the error, like the web composer that stays open on an error. The
 * card's revision only ever comes from the post's own update.
 */
export async function runMomentEdit(
  supabase: SupabaseClient,
  input: Readonly<{
    moment: TimelineMoment;
    initial: MomentEditDraft;
    draft: MomentEditDraft;
    taggedLabel: string | undefined;
    deviceTimeZone: string;
    patch: (id: string, update: (current: TimelineMoment) => TimelineMoment) => void;
    reopen: (state: EditReopen) => void;
    /** A conflict means the feed copy is stale: reload it. */
    refresh?: () => void;
    announce?: (message: string) => void;
    loadPhotos: (momentId: string) => Promise<TimelineMoment["photos"] | null>;
    wait?: (ms: number) => Promise<void>;
  }>,
): Promise<EditSaveResult> {
  const { moment, initial, draft } = input;
  const wait = input.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const write = editWrite(moment, initial, draft, input.deviceTimeZone);
  if (!write.ok) {
    input.reopen({ moment, draft, error: write.message });
    return { ok: false, message: write.message, conflict: false };
  }
  const shown = optimisticEditedMoment(
    moment,
    draft,
    { occurredAt: write.edit.occurredAt, occurredTimezone: write.edit.occurredTimezone },
    input.taggedLabel,
    write.edit.mentions,
  );
  const optimistic: TimelineMoment = draft.shareToCircleId
    ? { ...shown, audience: "family", linkedCircleIds: [draft.shareToCircleId] }
    : shown;
  input.patch(moment.id, (current) => ({ ...current, ...editedFields(optimistic) }));

  const result = await saveMomentEdit(supabase, input);
  if (!result.ok) {
    if (result.revision !== undefined) {
      // The text saved; a photo step did not. Keep the saved text, take the
      // new revision, and show the photos the post really has.
      const revision = result.revision;
      const photos = (await input.loadPhotos(moment.id)) ?? moment.photos;
      const saved: TimelineMoment = { ...optimistic, photos, revision };
      input.patch(moment.id, (current) => ({ ...current, ...editedFields(saved), revision }));
      input.reopen({ moment: saved, error: result.message });
      return result;
    }
    input.patch(moment.id, (current) => ({ ...current, ...editedFields(moment), revision: current.revision }));
    input.reopen({ moment, draft, error: result.message });
    if (result.conflict) input.refresh?.();
    return result;
  }

  input.patch(moment.id, (current) => ({ ...current, revision: result.revision }));
  input.announce?.("Changes to this moment were saved.");
  const plan = moment.kind === "photo" ? photoEditPlan(initial.photos, draft.photos) : null;
  if (plan && (plan.removedIds.length > 0 || plan.reorderIds)) {
    const photos = await input.loadPhotos(moment.id);
    if (photos) input.patch(moment.id, (current) => ({ ...current, photos }));
  }
  if (result.adding) {
    const expected = draft.photos.length;
    const added = await result.adding;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const photos = await input.loadPhotos(moment.id);
      if (photos) input.patch(moment.id, (current) => ({ ...current, photos }));
      if (!added.ok || (photos && photos.length >= expected)) break;
      await wait(1500);
    }
    // The real photos are on the card now; drop the local pending pages.
    if (added.ok) settlePending([added.jobId]);
  }
  return result;
}
