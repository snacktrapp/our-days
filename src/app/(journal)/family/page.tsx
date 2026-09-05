import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
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

export default async function FamilyPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>) {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getFamilyTimelineFixture();
    return (
      <JournalChrome
        model={model.chrome}
        section="timeline"
        switcher={model.switcher}
      >
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const { pages, snapshot } = await searchParams;
  const context = await loadConnectedJournalContext(access);
  const model = await loadConnectedTimeline(access, context, {
    pages: Number(pages ?? "1"),
    snapshotAt: snapshot,
  });
  return (
    <JournalChrome
      model={model.chrome}
      section="timeline"
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
