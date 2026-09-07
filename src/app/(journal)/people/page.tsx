import { JournalChrome } from "@/features/shell/journal-chrome";
import { PeoplePanel } from "@/features/people/people-panel";
import { getPeopleFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { previewGroupOptions } from "@/data/preview-groups.server";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";

export default async function PeoplePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ previewLoading?: string }>;
}>) {
  const access = await requireJournalAccess();
  if (access.mode === "preview") {
    const { previewLoading } = await searchParams;
    if (previewLoading === "navigation") {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const model = getPeopleFixture(await previewGroupOptions());
    return (
      <JournalChrome model={model.chrome} section="people">
        <PeoplePanel model={model} />
      </JournalChrome>
    );
  }
  const context = await loadConnectedJournalContext(access);
  const model = {
    chrome: { ...context.chrome, title: "Our people" },
    intro: "People in this group.",
    people: context.people,
    familySettingsHref: null,
  };
  return (
    <JournalChrome
      model={model.chrome}
      section="people"
      createMomentAction={createFamilyMomentAction}
    >
      <PeoplePanel model={model} />
    </JournalChrome>
  );
}
