import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoriesPanel } from "@/features/memories/memories-panel";
import { getMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccessUnlessRecoverable } from "@/lib/auth/journal-access";
import {
  loadMemoriesJournal,
  memoriesRefreshSoftFail,
} from "@/data/memories-home.server";
import { parseMemoryYear } from "@/data/memories.server";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";

export const metadata: Metadata = { title: "Memories — Our Days" };

export default async function MemoriesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ beforeYear?: string }> }>) {
  const access = await requireJournalAccessUnlessRecoverable();
  let model;
  if (!access) {
    model = memoriesRefreshSoftFail();
  } else if (access.mode === "preview") {
    model = getMemoriesFixture();
  } else {
    const { beforeYear: beforeYearValue } = await searchParams;
    const parsedBeforeYear = beforeYearValue
      ? parseMemoryYear(beforeYearValue)
      : undefined;
    if (beforeYearValue && !parsedBeforeYear) {
      notFound();
    }
    model = await loadMemoriesJournal(access, {
      beforeYear: parsedBeforeYear ?? undefined,
    });
  }
  return (
    <JournalChrome
      model={model.chrome}
      section="memories"
      createMomentAction={
        access?.mode === "authenticated" ? createFamilyMomentAction : undefined
      }
      preserveChrome={!access}
    >
      <MemoriesPanel model={model} />
    </JournalChrome>
  );
}
