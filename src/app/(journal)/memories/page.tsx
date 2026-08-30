import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoriesPanel } from "@/features/memories/memories-panel";
import { getMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

export const metadata: Metadata = { title: "Memories — Our Days" };

export default async function MemoriesPage() {
  await requirePreviewFixtureAccess();
  const model = getMemoriesFixture();
  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoriesPanel model={model} />
    </JournalChrome>
  );
}
