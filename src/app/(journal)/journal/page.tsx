import { requireJournalAccess } from "@/lib/auth/journal-access";
import { getFamilyTimelineFixture } from "@/fixtures/design-preview/timelines.server";
import { redirect } from "next/navigation";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const access = await requireJournalAccess();
  if ((await searchParams).view === "you") {
    const personId =
      access.mode === "preview"
        ? getFamilyTimelineFixture().chrome.composer.recorderPersonId
        : access.personId;
    redirect(`/people/${personId}`);
  }
  redirect("/family");
}
