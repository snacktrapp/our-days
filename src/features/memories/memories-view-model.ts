import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type { TimelineViewModel } from "@/features/timeline/timeline-view-model";

export type MemoryYearViewModel = Readonly<{
  year: string;
  href: string;
  ariaLabel: string;
}>;

export type MemoriesViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  heading: string;
  subheading: string;
  feature: Readonly<{
    href: string;
    imageSrc: string;
    imageAlt: string;
    dateLabel: string;
    title: string;
    actionLabel: string;
  }>;
  years: readonly MemoryYearViewModel[];
}>;

type MemoryJourneyBase = Readonly<{
  chrome: JournalChromeViewModel;
  returnHref: string;
  returnLabel: string;
  eyebrow: string;
  title: string;
  description: string;
}>;

export type MemoryJourneyViewModel = MemoryJourneyBase &
  (
    | Readonly<{ state: "moments"; timeline: TimelineViewModel }>
    | Readonly<{
        state: "empty";
        emptyState: Readonly<{ title: string; description: string }>;
      }>
  );
