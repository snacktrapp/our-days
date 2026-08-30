import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type { TimelineViewModel } from "@/features/timeline/timeline-view-model";

export type MemoryYearViewModel = Readonly<{
  year: string;
  href: string;
  ariaLabel: string;
}>;

export type MemoryFeatureViewModel =
  | Readonly<{
      state: "photo";
      href: string;
      imageSrc: string;
      imageAlt: string;
      dateLabel: string;
      title: string;
      actionLabel: string;
    }>
  | Readonly<{
      state: "moment";
      href: string;
      dateLabel: string;
      personName: string;
      personInitial: string;
      personAccent: import("@/features/accent-token").AccentToken;
      kindLabel: string;
      summary: string;
      actionLabel: string;
    }>
  | Readonly<{
      state: "empty";
      href: string;
      title: string;
      description: string;
      actionLabel: string;
    }>;

export type MemoriesViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  heading: string;
  subheading: string;
  feature: MemoryFeatureViewModel;
  years: readonly MemoryYearViewModel[];
  yearsEmptyMessage?: string;
  yearNavigation?: Readonly<{
    earlierHref?: string;
    newestHref?: string;
  }>;
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
