import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { VideoFeasibilityPanel } from "@/features/video/video-feasibility-panel";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export const metadata: Metadata = {
  title: "Video feasibility — Our Days",
};

export default async function VideoFeasibilityQualityPage() {
  await requireDesignPreview();
  const familyModel = getFamilyTimelineFixture();
  const chrome = {
    ...familyModel.chrome,
    eyebrow: "Quality-only preview",
    title: "Could video feel this quiet?",
  };

  return (
    <JournalChrome model={chrome} section="timeline" standaloneNavigation>
      <VideoFeasibilityPanel />
    </JournalChrome>
  );
}
