import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { getDesignPreviewOnThisDayFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import {
  loadMemoryJourneyJournal,
  memoryJourneyRefreshSoftFail,
} from "@/data/memories-home.server";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
  removeMomentPhotoAction,
  reorderMomentPhotosAction,
  setMomentReactionAction,
  trashMomentNoteAction,
  trashWrittenMomentAction,
  updateFamilyMomentAction,
  updateMomentNoteAction,
} from "@/features/moments/moment-actions";

export const metadata: Metadata = {
  title: "On this day — Our Days",
};

const connectedActions = {
  update: updateFamilyMomentAction,
  trash: trashWrittenMomentAction,
  removePhoto: removeMomentPhotoAction,
  reorderPhotos: reorderMomentPhotosAction,
};

const conversationActions = {
  load: loadMomentConversationAction,
  createNote: createMomentNoteAction,
  updateNote: updateMomentNoteAction,
  trashNote: trashMomentNoteAction,
  setReaction: setMomentReactionAction,
};

export default async function OnThisDayPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    pages?: string;
    snapshot?: string;
    anniversary?: string;
  }>;
}>) {
  const access = await requireJournalAccessUnlessRecoverable();
  if (!access) {
    const model = memoryJourneyRefreshSoftFail({ mode: "anniversary" });
    return (
      <JournalChrome model={model.chrome} section="memories" preserveChrome>
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    const model = getDesignPreviewOnThisDayFixture();
    return (
      <JournalChrome model={model.chrome} section="memories">
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  const { pages, snapshot, anniversary } = await searchParams;
  const model = await loadMemoryJourneyJournal(access, {
    mode: "anniversary",
    pages,
    snapshotAt: snapshot,
    anniversaryKey: anniversary,
  });
  return (
    <JournalChrome
      model={model.chrome}
      section="memories"
      createMomentAction={createFamilyMomentAction}
    >
      <MemoryJourneyPanel
        model={model}
        connectedActions={connectedActions}
        conversationActions={conversationActions}
      />
    </JournalChrome>
  );
}
