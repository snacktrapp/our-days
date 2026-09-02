import { PrivateEntry } from "@/features/auth/private-entry";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";
import { connection } from "next/server";
import { redirect } from "next/navigation";

export default async function Home() {
  await connection();

  if (isDesignPreviewEnabled()) redirect("/family");

  if (
    process.env.OUR_DAYS_RESOURCE_MODE === "supabase" ||
    process.env.OUR_DAYS_LOCAL_JOURNAL_MODE === "enabled"
  ) {
    const access = await requireJournalAccess();
    if (access.mode === "authenticated") redirect("/family");
  }

  return (
    <PrivateEntry
      connected={
        process.env.OUR_DAYS_RESOURCE_MODE === "supabase" ||
        process.env.OUR_DAYS_LOCAL_JOURNAL_MODE === "enabled"
      }
    />
  );
}
