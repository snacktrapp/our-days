import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedTimeline } from "@/data/moments.server";
import {
  createWrittenMomentAction,
  trashWrittenMomentAction,
  updateWrittenMomentAction,
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
      <JournalChrome model={model.chrome} section="timeline">
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
      createMomentAction={createWrittenMomentAction}
    >
      <TimelineFeed
        model={model}
        connectedActions={{
          update: updateWrittenMomentAction,
          trash: trashWrittenMomentAction,
        }}
      />
    </JournalChrome>
  );
}
