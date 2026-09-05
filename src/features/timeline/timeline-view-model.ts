import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";

export type MomentKind =
  "photo" | "video" | "thought" | "milestone" | "location" | "insight";

export type MomentReactionId = "held-close" | "made-me-smile" | "remember-this";

export type MomentInteractionViewModel = Readonly<{
  audienceName?: string;
  currentPerson: Readonly<{
    name: string;
    initial: string;
    accent: AccentToken;
  }>;
  taggablePeople?: readonly Readonly<{
    id: string;
    name: string;
    initial: string;
    accent: AccentToken;
  }>[];
  reactionOptions: readonly Readonly<{
    id: MomentReactionId;
    label: string;
    symbol: string;
  }>[];
}>;

export type MomentConversationViewModel = Readonly<{
  notes: readonly Readonly<{
    id: string;
    authorName: string;
    authorInitial: string;
    authorAccent: AccentToken;
    body: string;
    displayDate: string;
    revision?: number;
    canChange?: boolean;
  }>[];
  reactions: readonly Readonly<{
    id: string;
    personName: string;
    personInitial: string;
    personAccent: AccentToken;
    reactionId: MomentReactionId;
    isCurrentMember?: boolean;
  }>[];
}>;

type TimelineMomentBase = Readonly<{
  id: string;
  journalPersonId: string;
  personName: string;
  personInitial: string;
  personAccent: AccentToken;
  audience?: "family" | "just_me";
  showJustMeBadge?: boolean;
  displayTime?: string;
  displayDate: string;
  occurredOn: string;
  maxOccurredOn?: string;
  kicker: string;
  text: string;
  conversation: MomentConversationViewModel;
  canChange?: boolean;
  revision?: number;
  editOccurrence?: Readonly<{
    occurredAt: string | null;
    timeZone: string | null;
  }>;
  taggedPeopleLabel?: string;
  taggedPeople?: readonly Readonly<{ id: string; name: string }>[];
  placeName?: string;
  latitude?: number;
  longitude?: number;
}>;

export type TimelinePhotoView = Readonly<{
  id: string;
  src: string;
  alt: string;
  width?: number;
  height?: number;
}>;

export type PhotoMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "photo";
    image: Readonly<{
      src: string;
      alt: string;
      badgeLabel: string;
      delivery?: "private";
      width?: number;
      height?: number;
    }>;
    photos?: readonly TimelinePhotoView[];
  }>;

export type ThoughtMomentViewModel = TimelineMomentBase &
  Readonly<{ kind: "thought" }>;

export type VideoMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "video";
    video: Readonly<{
      src: string;
      durationMs?: number;
      width?: number;
      height?: number;
    }>;
  }>;

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
    ageLabel?: string;
    yearLabel?: string;
  }>;

export type InsightMomentViewModel = TimelineMomentBase &
  Readonly<{
    kind: "insight";
    attribution: string;
    sourceUrl?: string;
    sourceLabel?: string;
  }>;

export type TimelineMomentViewModel =
  | PhotoMomentViewModel
  | VideoMomentViewModel
  | ThoughtMomentViewModel
  | LocationMomentViewModel
  | MilestoneMomentViewModel
  | InsightMomentViewModel;

type MomentDetailBase = Readonly<{
  id: string;
  personName: string;
  personAccent: AccentToken;
  displayDate: string;
  kicker: string;
  text: string;
  conversation: MomentConversationViewModel;
  taggedPeopleLabel?: string;
  placeName?: string;
}>;

export type MomentDetailViewModel =
  | (MomentDetailBase & Readonly<{ kind: "photo" }>)
  | (MomentDetailBase & Readonly<{ kind: "video" }>)
  | (MomentDetailBase & Readonly<{ kind: "thought" }>)
  | (MomentDetailBase &
      Readonly<{
        kind: "location";
        place: string;
      }>)
  | (MomentDetailBase &
      Readonly<{
        kind: "milestone";
        milestone: string;
      }>)
  | (MomentDetailBase &
      Readonly<{
        kind: "insight";
        attribution: string;
        sourceUrl?: string;
        sourceLabel?: string;
      }>);

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
    }>
  | Readonly<{
      id: string;
      entryType: "empty-state";
      title: string;
      message: string;
    }>;

export type TimelineViewModel = Readonly<{
  chrome: JournalChromeViewModel;
  interaction?: MomentInteractionViewModel;
  switcher: readonly Readonly<{
    label: string;
    href: string;
    current: boolean;
  }>[];
  timelineLabel?: string;
  personalIntro?: Readonly<{
    initial: string;
    accent: AccentToken;
    title: string;
    summary: string;
  }>;
  entries: readonly TimelineEntryViewModel[];
  pagination?: Readonly<{
    nextHref: string;
    label: string;
  }>;
  paginationError?: Readonly<{
    retryHref: string;
    message: string;
    label: string;
  }>;
}>;
