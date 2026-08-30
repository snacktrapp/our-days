import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { getDesignPreviewOnThisDayFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export const metadata: Metadata = {
  title: "On this day — Our Days",
};

export default async function OnThisDayPage() {
  await requireDesignPreview();
  const model = getDesignPreviewOnThisDayFixture();
  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoryJourneyPanel model={model} />
    </JournalChrome>
  );
}
