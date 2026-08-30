import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type MomentKind = "photo" | "thought" | "milestone" | "location";

type TimelineMomentBase = Readonly<{
  id: string;
  personName: string;
  personInitial: string;
  personAccent: AccentToken;
  displayTime: string;
  displayDate: string;
  occurredOn: string;
  kicker: string;
  text: string;
  noteCount: number;
  taggedPeopleLabel?: string;
}>;

export type PhotoMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "photo";
    image: Readonly<{ src: string; alt: string; badgeLabel: string }>;
  }>;

export type ThoughtMomentViewModel = TimelineMomentBase &
  Readonly<{ kind: "thought" }>;

export type LocationMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "location";
    place: string;
    mapLabel: string;
  }>;

export type MilestoneMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "milestone";
    milestone: string;
    ageLabel: string;
    yearLabel: string;
  }>;

export type TimelineMomentViewModel =
  | PhotoMomentViewModel
  | ThoughtMomentViewModel
  | LocationMomentViewModel
  | MilestoneMomentViewModel;

export type TimelineEntryViewModel =
  | Readonly<{
      id: string;
      entryType: "date-marker";
      label: string;
      divider?: boolean;
    }>
  | Readonly<{ id: string; entryType: "elapsed-gap"; label: string }>
  | Readonly<{
      id: string;
      entryType: "moment";
      moment: TimelineMomentViewModel;
    }>
  | Readonly<{
      id: string;
      entryType: "end-message";
      markerLabel: string;
      message: string;
    }>;

export type TimelineViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  switcher: readonly Readonly<{
    label: string;
    href: string;
    current: boolean;
  }>[];
  personalIntro?: Readonly<{
    initial: string;
    accent: AccentToken;
    title: string;
    summary: string;
  }>;
  entries: readonly TimelineEntryViewModel[];
}>;
