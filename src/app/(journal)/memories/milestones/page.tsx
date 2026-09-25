import { Suspense } from "react";
import type { Metadata } from "next";
import {
  loadMemoryJourneyJournal,
  memoryJourneyRefreshSoftFail,
} from "@/data/memories-home.server";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
  removeMomentPhotoAction,
  reorderMomentPhotosAction,
  setMomentNoteHeartAction,
  setMomentReactionAction,
  trashMomentNoteAction,
  trashWrittenMomentAction,
  updateFamilyMomentAction,
  updateMomentNoteAction,
} from "@/features/moments/moment-actions";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  JournalActivitySlot,
  JournalActivitySlotFallback,
} from "@/features/shell/journal-activity-slot";
import { getMilestoneMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";

export const metadata: Metadata = {
  title: "Milestones — Our Days",
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
  setNoteHeart: setMomentNoteHeartAction,
};

export default async function MilestonesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>) {
  const access = await requireJournalAccessUnlessRecoverable();
  if (!access) {
    const model = memoryJourneyRefreshSoftFail({ mode: "milestones" });
    return (
      <JournalChrome model={model.chrome} section="memories" preserveChrome>
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    const model = getMilestoneMemoriesFixture();
    return (
      <JournalChrome model={model.chrome} section="memories">
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }

  const { pages, snapshot } = await searchParams;
  const model = await loadMemoryJourneyJournal(access, {
    mode: "milestones",
    pages,
    snapshotAt: snapshot,
  });

  return (
    <JournalChrome
      model={model.chrome}
      section="memories"
      createMomentAction={createFamilyMomentAction}
      activity={
        <Suspense fallback={<JournalActivitySlotFallback />}>
          <JournalActivitySlot access={access} />
        </Suspense>
      }
    >
      <MemoryJourneyPanel
        model={model}
        connectedActions={connectedActions}
        conversationActions={conversationActions}
      />
    </JournalChrome>
  );
}
