import Link from "next/link";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { PeoplePanel } from "@/features/people/people-panel";
import { getPeopleFixture } from "@/fixtures/design-preview/timelines.server";
import { previewGroupOptions } from "@/data/preview-groups.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadPeopleDirectory } from "@/data/people.server";
import {
  anonymousJournalAccess,
  fallbackJournalChrome,
} from "@/data/journal-chrome-fallback";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";

export default async function CirclesPage() {
  const access = await requireJournalAccessUnlessRecoverable();
  if (access?.mode === "preview") {
    const model = getPeopleFixture(await previewGroupOptions());
    return (
      <JournalChrome model={model.chrome} section="circles">
        <PeoplePanel model={model} />
      </JournalChrome>
    );
  }
  let model;
  if (access) {
    try {
      const context = await loadConnectedJournalContext(access, {
        includeActivity: false,
      });
      model = await loadPeopleDirectory(access, context);
    } catch (error) {
      if (isFatalJournalHomeError(error)) throw error;
    }
  }
  if (model)
    return (
      <JournalChrome
        model={model.chrome}
        section="circles"
        createMomentAction={createFamilyMomentAction}
      >
        <PeoplePanel model={model} />
      </JournalChrome>
    );
  return (
    <JournalChrome
      model={fallbackJournalChrome(access ?? anonymousJournalAccess(), {
        title: "Circles",
        eyebrow: "Journals",
      })}
      section="circles"
      createMomentAction={access ? createFamilyMomentAction : undefined}
    >
      <section className="people-panel">
        <p>Circles couldn’t load. Your journal is still available.</p>
        <Link href="/circles" prefetch={false}>
          Try again
        </Link>
      </section>
    </JournalChrome>
  );
}
