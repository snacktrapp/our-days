import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { getDesignPreviewOnThisDayFixture } from "@/fixtures/design-preview/timelines.server";
import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

export const metadata: Metadata = {
  title: "On this day — Our Days",
};

export default async function OnThisDayPage() {
  await requirePreviewFixtureAccess();
  const model = getDesignPreviewOnThisDayFixture();
  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoryJourneyPanel model={model} />
    </JournalChrome>
  );
}
