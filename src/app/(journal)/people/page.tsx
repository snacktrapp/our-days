import { JournalChrome } from "@/features/shell/journal-chrome";
import { PeoplePanel } from "@/features/people/people-panel";
import { getPeopleFixture } from "@/fixtures/design-preview/timelines.server";
import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

export default async function PeoplePage() {
  await requirePreviewFixtureAccess();
  const model = getPeopleFixture();
  return (
    <JournalChrome model={model.chrome} section="people">
      <PeoplePanel model={model} />
    </JournalChrome>
  );
}
