import type { Metadata } from "next";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getOnThisDayFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export const metadata: Metadata = {
  title: "Empty memory preview — Our Days",
};

export default async function EmptyMemoriesQualityPage() {
  await requireDesignPreview();
  const model = getOnThisDayFixture("03-04");
  if (model.state !== "empty") {
    throw new Error("The empty Memories quality fixture contains a moment.");
  }

  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoryJourneyPanel model={model} />
    </JournalChrome>
  );
}
