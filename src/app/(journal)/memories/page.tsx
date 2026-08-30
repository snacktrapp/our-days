import type { Metadata } from "next";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { MemoriesPanel } from "@/features/memories/memories-panel";
import { getMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requireJournalAccess } from "@/lib/auth/journal-access";
import { loadConnectedJournalContext } from "@/data/journal-context.server";
import { loadConnectedMemories, parseMemoryYear } from "@/data/memories.server";
import { createFamilyMomentAction } from "@/features/moments/moment-actions";

export const metadata: Metadata = { title: "Memories — Our Days" };

export default async function MemoriesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ beforeYear?: string }> }>) {
  const access = await requireJournalAccess();
  let model;
  if (access.mode === "preview") {
    model = getMemoriesFixture();
  } else {
    const [{ beforeYear: beforeYearValue }, context] = await Promise.all([
      searchParams,
      loadConnectedJournalContext(access),
    ]);
    const parsedBeforeYear = beforeYearValue
      ? parseMemoryYear(beforeYearValue)
      : undefined;
    if (beforeYearValue && !parsedBeforeYear) {
      throw new Error("Memory year cursor is invalid");
    }
    const beforeYear = parsedBeforeYear ?? undefined;
    model = await loadConnectedMemories(access, context, { beforeYear });
  }
  return (
    <JournalChrome
      model={model.chrome}
      section="memories"
      createMomentAction={
        access.mode === "authenticated" ? createFamilyMomentAction : undefined
      }
    >
      <MemoriesPanel model={model} />
    </JournalChrome>
  );
}
