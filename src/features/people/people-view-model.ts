import type {
  AccentToken,
  JournalChromeViewModel,
} from "@/features/shell/shell-view-model";

export type PersonSummaryViewModel = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  roleLabel: string;
  journalHref?: string;
}>;

export type PeopleViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  intro: string;
  people: readonly PersonSummaryViewModel[];
}>;
