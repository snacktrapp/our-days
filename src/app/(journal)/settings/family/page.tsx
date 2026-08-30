import { FamilySettingsPanel } from "@/features/family-settings/family-settings-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export default async function FamilySettingsPage() {
  await requireDesignPreview();
  const model = getFamilySettingsFixture();

  return (
    <JournalChrome model={model.chrome} section="settings">
      <FamilySettingsPanel model={model.panel} />
    </JournalChrome>
  );
}
