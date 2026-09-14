import { redirect } from "next/navigation";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadManageableTrash } from "@/data/trash.server";
import { TrashPanel } from "@/features/moments/trash-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { JournalPanelInterrupted } from "@/features/shell/journal-interrupted";
import {
  createFamilyMomentAction,
  restoreWrittenMomentAction,
} from "@/features/moments/moment-actions";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import { isFatalJournalHomeError } from "@/lib/auth/family-session-error";
import {
  anonymousJournalAccess,
  fallbackJournalChrome,
} from "@/data/journal-chrome-fallback";
import { SignOutButton } from "@/features/auth/sign-out-button";

function trashChrome(
  access: Readonly<{ circleId: string; personId: string }>,
  title = "Recently removed",
) {
  return fallbackJournalChrome(access, {
    title,
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
  try {
    const [context, moments] = await Promise.all([
      loadConnectedJournalContext(access),
      loadManageableTrash(access),
    ]);
    const chrome = { ...context.chrome, title: "Recently removed" };
    return (
      <JournalChrome
        model={chrome}
        section="trash"
        createMomentAction={createFamilyMomentAction}
      >
        <TrashPanel moments={moments} restore={restoreWrittenMomentAction} />
        <div className="trash-sign-out">
          <SignOutButton />
        </div>
      </JournalChrome>
    );
  } catch (error) {
    if (isFatalJournalHomeError(error)) throw error;
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
}
