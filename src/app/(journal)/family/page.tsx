import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export default async function FamilyPage() {
  await requireDesignPreview();
  const model = getFamilyTimelineFixture();
  return (
    <JournalChrome model={model.chrome} section="timeline">
      <TimelineFeed model={model} />
    </JournalChrome>
  );
}
