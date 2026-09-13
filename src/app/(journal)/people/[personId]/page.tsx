import { JournalChrome } from "@/features/shell/journal-chrome";
import { PrivateSoftNotFound } from "@/features/shell/private-soft-not-found";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getPersonalTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { selectActiveGroupAction } from "@/features/groups/create-group-action";
import { previewGroupOptions } from "@/data/preview-groups.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadPersonJournal } from "@/data/person-journal.server";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
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
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>) {
  const { personId } = await params;
  const access = await requireJournalAccess({ personId });
  if (access.mode === "preview") {
    const model = getPersonalTimelineFixture(
      personId,
      await previewGroupOptions(),
    );
    if (!model) return <PrivateSoftNotFound />;
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
        onSelectGroup={selectActiveGroupAction}
      >
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const { pages, snapshot } = await searchParams;
  const model = await loadPersonJournal(access, {
    personId,
    pages,
    snapshotAt: snapshot,
  });
  if (!model) return <PrivateSoftNotFound />;
  return (
    <JournalChrome
      model={model.chrome}
      section="timeline"
      createMomentAction={createFamilyMomentAction}
      switcher={model.switcher}
      onSelectGroup={selectActiveGroupAction}
    >
      <TimelineFeed
        model={model}
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
        }}
      />
    </JournalChrome>
  );
}
