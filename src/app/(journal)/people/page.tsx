import { JournalChrome } from "@/features/shell/journal-chrome";
import { PeoplePanel } from "@/features/people/people-panel";
import { getPeopleFixture } from "@/fixtures/design-preview/timelines.server";
import { requireDesignPreview } from "@/lib/design-preview.server";

export default async function PeoplePage() {
  await requireDesignPreview();
  const model = getPeopleFixture();
  return (
    <JournalChrome model={model.chrome} section="people">
      <PeoplePanel model={model} />
    </JournalChrome>
  );
}
