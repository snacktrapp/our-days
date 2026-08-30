import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getPersonalTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";
import { notFound } from "next/navigation";

export default async function PersonJournalPage({
  params,
}: Readonly<{ params: Promise<{ personId: string }> }>) {
  await requireDesignPreview();
  const { personId } = await params;
  const model = getPersonalTimelineFixture(personId);
  if (!model) notFound();
  return (
    <JournalChrome model={model.chrome} section="people">
      <TimelineFeed model={model} />
    </JournalChrome>
  );
}
