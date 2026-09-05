import { JournalChrome } from "@/features/shell/journal-chrome";
import { PrivateSoftNotFound } from "@/features/shell/private-soft-not-found";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getPersonalTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedTimeline } from "@/data/moments.server";
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
} from "@/features/moments/moment-actions";

export default async function PersonJournalPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>) {
  const access = await requireJournalAccess();
  const { personId } = await params;
  if (access.mode === "preview") {
    const model = getPersonalTimelineFixture(personId);
    if (!model) return <PrivateSoftNotFound />;
    return (
      <JournalChrome
        model={model.chrome}
        section="people"
        switcher={model.switcher}
      >
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const [{ pages, snapshot }, context] = await Promise.all([
    searchParams,
    loadConnectedJournalContext(access),
  ]);
  if (!context.people.some((person) => person.id === personId)) {
    return <PrivateSoftNotFound />;
  }
  const model = await loadConnectedTimeline(access, context, {
    journalPersonId: personId,
    pages: Number(pages ?? "1"),
    snapshotAt: snapshot,
  });
  return (
    <JournalChrome
      model={model.chrome}
      section="people"
      createMomentAction={createFamilyMomentAction}
      switcher={model.switcher}
    >
      <TimelineFeed
        model={model}
        connectedActions={{
          update: updateFamilyMomentAction,
          trash: trashWrittenMomentAction,
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
