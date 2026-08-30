import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { getDesignPreviewOnThisDayFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedMemoryJourney } from "@/data/memories.server";
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

export const metadata: Metadata = {
  title: "On this day — Our Days",
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
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getDesignPreviewOnThisDayFixture();
    return (
      <JournalChrome model={model.chrome} section="memories">
        <MemoryJourneyPanel model={model} />
      </JournalChrome>
    );
  }
  const [{ pages, snapshot, anniversary }, context] = await Promise.all([
    searchParams,
    loadConnectedJournalContext(access),
  ]);
  const model = await loadConnectedMemoryJourney(access, context, {
    mode: "anniversary",
    pages: Number(pages ?? "1"),
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
