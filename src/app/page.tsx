import { journalPersistenceIsConnected } from "../../config/our-days-environment";
import { PrivateEntry } from "@/features/auth/private-entry";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";
import { connection } from "next/server";
import { redirect } from "next/navigation";

export default async function Home() {
  await connection();

  if (isDesignPreviewEnabled()) redirect("/family");

  const connected = journalPersistenceIsConnected();
  if (connected) {
    const access = await requireJournalAccess();
    if (access.mode === "authenticated") redirect("/family");
  }

  return <PrivateEntry connected={connected} />;
}
