import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  JournalActivitySlot,
  JournalActivitySlotFallback,
} from "@/features/shell/journal-activity-slot";
import { getYearMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import {
  loadMemoryJourneyJournal,
  memoryJourneyRefreshSoftFail,
} from "@/data/memories-home.server";
import { parseMemoryYear } from "@/data/memories.server";
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

type YearMemoriesProps = Readonly<{
  params: Promise<{ year: string }>;
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>;

export async function generateMetadata({
  params,
}: YearMemoriesProps): Promise<Metadata> {
  const { year } = await params;
  return {
    title: parseMemoryYear(year)
      ? `${year} memories — Our Days`
      : "Memories — Our Days",
  };
}

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

export default async function YearMemoriesPage({
  params,
  searchParams,
}: YearMemoriesProps) {
  const access = await requireJournalAccessUnlessRecoverable();
  const { year } = await params;
  if (!access) {
    const model = memoryJourneyRefreshSoftFail({
      mode: "year",
      year: parseMemoryYear(year) ?? 0,
    });
    return (
      <JournalChrome model={model.chrome} section="memories" preserveChrome>
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") {
    const model = getYearMemoriesFixture(year);
    if (!model) notFound();
    return (
      <JournalChrome model={model.chrome} section="memories">
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  const memoryYear = parseMemoryYear(year);
  if (!memoryYear) notFound();
  const { pages, snapshot } = await searchParams;
  const model = await loadMemoryJourneyJournal(access, {
    mode: "year",
    year: memoryYear,
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
