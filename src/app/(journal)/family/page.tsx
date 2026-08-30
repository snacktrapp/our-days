import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

export default async function FamilyPage() {
  await requirePreviewFixtureAccess();
  const model = getFamilyTimelineFixture();
  return (
    <JournalChrome model={model.chrome} section="timeline">
      <TimelineFeed model={model} />
    </JournalChrome>
  );
}
