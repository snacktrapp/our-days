import { redirect } from "next/navigation";
import { loadTrashJournal } from "@/data/trash.server";
import { TrashPanel } from "@/features/moments/trash-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { JournalPanelInterrupted } from "@/features/shell/journal-interrupted";
import {
  createFamilyMomentAction,
  restoreWrittenMomentAction,
} from "@/features/moments/moment-actions";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import {
  anonymousJournalAccess,
  fallbackJournalChrome,
} from "@/data/journal-chrome-fallback";
import { SignOutButton } from "@/features/auth/sign-out-button";

function trashChrome(access: Readonly<{ circleId: string; personId: string }>) {
  return fallbackJournalChrome(access, {
    title: "Recently removed",
    eyebrow: "Account",
  });
}

export default async function TrashPage() {
  const access = await requireJournalAccessUnlessRecoverable();
  if (!access) {
    return (
      <JournalChrome
        model={trashChrome(anonymousJournalAccess())}
        section="trash"
        preserveChrome
      >
        <JournalPanelInterrupted message="We couldn’t open Recently removed just now." />
      </JournalChrome>
    );
  }
  if (access.mode === "preview") redirect("/family");
  const loaded = await loadTrashJournal(access);
  if (!loaded.ok) {
    return (
      <JournalChrome
        model={trashChrome(access)}
        section="trash"
        createMomentAction={createFamilyMomentAction}
        preserveChrome
      >
        <JournalPanelInterrupted message="We couldn’t open Recently removed just now.">
          <div className="trash-sign-out">
            <SignOutButton />
          </div>
        </JournalPanelInterrupted>
      </JournalChrome>
    );
  }
  return (
    <JournalChrome
      model={{ ...loaded.context.chrome, title: "Recently removed" }}
      section="trash"
      createMomentAction={createFamilyMomentAction}
    >
      <TrashPanel
        moments={loaded.moments}
        restore={restoreWrittenMomentAction}
      />
      <div className="trash-sign-out">
        <SignOutButton />
      </div>
    </JournalChrome>
  );
}
