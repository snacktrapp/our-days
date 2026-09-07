import { redirect } from "next/navigation";
import { requireJournalAccess } from "@/lib/auth/journal-access";

export default async function PeoplePage() {
  await requireJournalAccess();
  redirect("/settings/family");
}
