import type { Metadata } from "next";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedMemoryJourney } from "@/data/memories.server";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import {
  createFamilyMomentAction,
  createMomentNoteAction,
  loadMomentConversationAction,
  setMomentReactionAction,
  trashMomentNoteAction,
  trashWrittenMomentAction,
  updateFamilyMomentAction,
  updateMomentNoteAction,
} from "@/features/moments/moment-actions";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getMilestoneMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";

export const metadata: Metadata = {
  title: "Milestones — Our Days",
};

export default async function MilestonesPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>) {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getMilestoneMemoriesFixture();
    return (
      <JournalChrome model={model.chrome} section="memories">
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }

  const [{ pages, snapshot }, context] = await Promise.all([
    searchParams,
    loadConnectedJournalContext(access),
  ]);
  const model = await loadConnectedMemoryJourney(access, context, {
    mode: "milestones",
    pages: Number(pages ?? "1"),
    snapshotAt: snapshot,
  });

  return (
    <JournalChrome
      model={model.chrome}
      section="memories"
      createMomentAction={createFamilyMomentAction}
    >
      <MemoryJourneyPanel
        model={model}
        connectedActions={{
          update: updateFamilyMomentAction,
          trash: trashWrittenMomentAction,
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
