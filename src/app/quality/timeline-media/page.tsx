import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import { getTimelineMediaDemoFixture } from "@/fixtures/design-preview/timelines.server";
import { requireFixtureDemoRoute } from "@/lib/fixture-demo-route.server";

export const metadata: Metadata = {
  title: "Inline timeline media — Our Days",
};

export default async function TimelineMediaQualityPage() {
  await requireFixtureDemoRoute();
  const model = getTimelineMediaDemoFixture();

  return (
    <JournalChrome model={model.chrome} section="timeline" standaloneNavigation>
      <TimelineFeed model={model} />
    </JournalChrome>
  );
}
