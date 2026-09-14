import { redirect } from "next/navigation";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";

export default async function PeoplePage() {
  const access = await requireJournalAccessUnlessRecoverable();
  if (!access) redirect("/family");
  redirect("/settings/family");
}
