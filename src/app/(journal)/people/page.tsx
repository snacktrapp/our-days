import { JournalChrome } from "@/features/shell/journal-chrome";
import { PeoplePanel } from "@/features/people/people-panel";
import { getPeopleFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { createWrittenMomentAction } from "@/features/moments/moment-actions";

export default async function PeoplePage() {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const model = getPeopleFixture();
    return (
      <JournalChrome model={model.chrome} section="people">
        <PeoplePanel model={model} />
      </JournalChrome>
    );
  }
  const context = await loadConnectedJournalContext(access);
  const model = {
    chrome: { ...context.chrome, title: "Our people" },
    intro:
      "Each person has a journal of their own, held inside this private family circle.",
    people: context.people,
    familySettingsHref: null,
  };
  return (
    <JournalChrome
      model={model.chrome}
      section="people"
      createMomentAction={createWrittenMomentAction}
    >
      <PeoplePanel model={model} />
    </JournalChrome>
  );
}
