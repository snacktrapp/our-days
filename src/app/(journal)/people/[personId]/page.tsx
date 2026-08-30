import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getPersonalTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { notFound } from "next/navigation";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedTimeline } from "@/data/moments.server";
import {
  createWrittenMomentAction,
  trashWrittenMomentAction,
  updateWrittenMomentAction,
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
    if (!model) notFound();
    return (
      <JournalChrome model={model.chrome} section="people">
        <TimelineFeed model={model} />
      </JournalChrome>
    );
  }
  const [{ pages, snapshot }, context] = await Promise.all([
    searchParams,
    loadConnectedJournalContext(access),
  ]);
  if (!context.people.some((person) => person.id === personId)) notFound();
  const model = await loadConnectedTimeline(access, context, {
    journalPersonId: personId,
    pages: Number(pages ?? "1"),
    snapshotAt: snapshot,
  });
  return (
    <JournalChrome
      model={model.chrome}
      section="people"
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
