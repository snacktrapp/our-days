import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoriesPanel } from "@/features/memories/memories-panel";
import { getMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export default async function MemoriesPage() {
  await requireDesignPreview();
  const model = getMemoriesFixture();
  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoriesPanel model={model} />
    </JournalChrome>
  );
}
