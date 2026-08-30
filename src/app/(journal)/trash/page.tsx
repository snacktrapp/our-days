import { redirect } from "next/navigation";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadManageableTrash } from "@/data/trash.server";
import { TrashPanel } from "@/features/moments/trash-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import {
  createWrittenMomentAction,
  restoreWrittenMomentAction,
} from "@/features/moments/moment-actions";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { SignOutButton } from "@/features/auth/sign-out-button";

export default async function TrashPage() {
  const access = await requireJournalAccess();
  if (access.mode === "preview") redirect("/family");
  const [context, moments] = await Promise.all([
    loadConnectedJournalContext(access),
    loadManageableTrash(access),
  ]);
  const chrome = { ...context.chrome, title: "Recently removed" };
  return (
    <JournalChrome
      model={chrome}
      section="trash"
      createMomentAction={createWrittenMomentAction}
    >
      <TrashPanel moments={moments} restore={restoreWrittenMomentAction} />
      <div className="trash-sign-out">
        <SignOutButton />
      </div>
    </JournalChrome>
  );
}
