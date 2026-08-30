import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";
import { redirect } from "next/navigation";

export default async function JournalPage() {
  await requirePreviewFixtureAccess();
  redirect("/family");
}
