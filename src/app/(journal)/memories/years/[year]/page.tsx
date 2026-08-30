import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoryJourneyPanel } from "@/features/memories/memory-journey-panel";
import { JournalChrome } from "@/features/shell/journal-chrome";
import { getYearMemoriesFixture } from "@/fixtures/design-preview/timelines.server";
import { requirePreviewFixtureAccess } from "@/lib/auth/journal-access";

type YearMemoriesProps = Readonly<{ params: Promise<{ year: string }> }>;

export async function generateMetadata({
  params,
}: YearMemoriesProps): Promise<Metadata> {
  await requirePreviewFixtureAccess();
  const { year } = await params;
  const model = getYearMemoriesFixture(year);
  return {
    title: model ? `${year} memories — Our Days` : "Memories — Our Days",
  };
}

export default async function YearMemoriesPage({ params }: YearMemoriesProps) {
  await requirePreviewFixtureAccess();
  const { year } = await params;
  const model = getYearMemoriesFixture(year);
  if (!model) notFound();

  return (
    <JournalChrome model={model.chrome} section="memories">
      <MemoryJourneyPanel model={model} />
    </JournalChrome>
  );
}
