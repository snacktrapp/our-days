import { Suspense } from "react";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  JournalActivitySlot,
  JournalActivitySlotFallback,
} from "@/features/shell/journal-activity-slot";
import { withCircleBrowseContext } from "@/features/shell/journal-routes";
import { PrivateSoftNotFound } from "@/features/shell/private-soft-not-found";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getPersonalTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { selectActiveGroupAction } from "@/features/groups/create-group-action";
import { previewGroupOptions } from "@/data/preview-groups.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import {
  loadPersonJournal,
  personJournalRefreshSoftFail,
} from "@/data/person-journal.server";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
  setMomentNoteHeartAction,
  setMomentReactionAction,
  removeMomentPhotoAction,
  reorderMomentPhotosAction,
  trashWrittenMomentAction,
  trashMomentNoteAction,
  updateFamilyMomentAction,
  updateMomentNoteAction,
  setMomentAudienceAction,
} from "@/features/moments/moment-actions";

export default async function PersonJournalPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ personId: string }>;
  searchParams: Promise<{
    pages?: string;
    snapshot?: string;
    fromCircle?: string;
  }>;
}>) {
  const { personId } = await params;
  const { pages, snapshot, fromCircle } = await searchParams;
  const backToCirclesHref = fromCircle
    ? `/circles#circle-${encodeURIComponent(fromCircle)}`
    : undefined;
  const access = await requireJournalAccessUnlessRecoverable({ personId });
  if (!access) {
    const model = personJournalRefreshSoftFail(personId);
    return (
      <JournalChrome
        backToCirclesHref={backToCirclesHref}
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
        preserveChrome
      >
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    const model = getPersonalTimelineFixture(
      personId,
      await previewGroupOptions(),
    );
    if (!model) return <PrivateSoftNotFound />;
    return (
      <JournalChrome
        backToCirclesHref={backToCirclesHref}
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
      >
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const model = await loadPersonJournal(access, {
    personId,
    pages,
    snapshotAt: snapshot,
  });
  if (!model) return <PrivateSoftNotFound />;
  return (
    <JournalChrome
      backToCirclesHref={backToCirclesHref}
      model={model.chrome}
      section="timeline"
      createMomentAction={createFamilyMomentAction}
      switcher={model.switcher}
      onSelectGroup={selectActiveGroupAction}
      activity={
        <Suspense fallback={<JournalActivitySlotFallback />}>
          <JournalActivitySlot access={access} />
        </Suspense>
      }
    >
      <TimelineFeed
        model={{
          ...model,
          pagination: model.pagination
            ? {
                ...model.pagination,
                nextHref: withCircleBrowseContext(
                  model.pagination.nextHref,
                  fromCircle,
                ),
              }
            : undefined,
          paginationError: model.paginationError
            ? {
                ...model.paginationError,
                retryHref: withCircleBrowseContext(
                  model.paginationError.retryHref,
                  fromCircle,
                ),
              }
            : undefined,
        }}
        connectedActions={{
          update: updateFamilyMomentAction,
          trash: trashWrittenMomentAction,
          setAudience: setMomentAudienceAction,
          removePhoto: removeMomentPhotoAction,
          reorderPhotos: reorderMomentPhotosAction,
        }}
        conversationActions={{
          load: loadMomentConversationAction,
          createNote: createMomentNoteAction,
          updateNote: updateMomentNoteAction,
          trashNote: trashMomentNoteAction,
          setReaction: setMomentReactionAction,
          setNoteHeart: setMomentNoteHeartAction,
        }}
      />
    </JournalChrome>
  );
}
