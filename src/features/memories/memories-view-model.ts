import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

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
  years: readonly string[];
}>;
