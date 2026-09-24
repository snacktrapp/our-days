import {
  journalPersistenceIsConnected,
  localJournalIsEnabled,
} from "../../config/our-days-environment";
import { PrivateEntry } from "@/features/auth/private-entry";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { hasOurDaysAuthSessionCookie } from "@/lib/auth/session-cookies.server";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";
import { redirect } from "next/navigation";

export default async function Home() {
  if (isDesignPreviewEnabled()) redirect("/family");

  const connected = journalPersistenceIsConnected();
  if (connected) {
    if (!localJournalIsEnabled()) {
      if (await hasOurDaysAuthSessionCookie()) redirect("/family");
    } else {
      const access = await requireJournalAccess();
      if (access.mode === "authenticated") redirect("/family");
    }
  }

  return <PrivateEntry connected={connected} />;
}
