import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getYearMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import {
  loadConnectedMemoryJourney,
  parseMemoryYear,
} from "@/data/memories.server";
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

type YearMemoriesProps = Readonly<{
  params: Promise<{ year: string }>;
  searchParams: Promise<{ pages?: string; snapshot?: string }>;
}>;

export async function generateMetadata({
  params,
}: YearMemoriesProps): Promise<Metadata> {
  const access = await requireJournalAccess();
  const { year } = await params;
  if (access.mode === "authenticated") {
    return {
      title: parseMemoryYear(year)
        ? `${year} memories — Our Days`
        : "Memories — Our Days",
    };
  }
  const model = getYearMemoriesFixture(year);
  return {
    title: model ? `${year} memories — Our Days` : "Memories — Our Days",
  };
}

export default async function YearMemoriesPage({
  params,
  searchParams,
}: YearMemoriesProps) {
  const access = await requireJournalAccess();
  const { year } = await params;
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
  const [{ pages, snapshot }, context] = await Promise.all([
    searchParams,
    loadConnectedJournalContext(access),
  ]);
  const model = await loadConnectedMemoryJourney(access, context, {
    mode: "year",
    year: memoryYear,
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
