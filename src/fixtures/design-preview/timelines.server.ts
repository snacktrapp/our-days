import "server-only";

import type {
  MomentConversationViewModel,
  MomentInteractionViewModel,
  TimelineEntryViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "@/features/memories/memories-view-model";
import type { PeopleViewModel } from "@/features/people/people-view-model";
import type { FamilySettingsViewModel } from "@/features/family-settings/family-settings-view-model";
import type { AccentToken } from "@/features/accent-token";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import { buildTimelineEntries } from "@/data/moments.server";
import {
  anniversaryKey,
  compareMemoryDatesDescending,
  elapsedCalendarLabel,
  formatAnniversaryLabel,
  matchesAnniversary,
} from "@/features/memories/memory-date";

const familyMark = [
  { id: "brian", initial: "B", accent: "teal" },
  { id: "molly", initial: "M", accent: "clay" },
] as const;

const timelineInteraction = {
  currentPerson: {
    name: "Brian",
    initial: "B",
    accent: "teal",
  },
  reactionOptions: [
    { id: "held-close", label: "Hold close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "✦" },
    { id: "remember-this", label: "I remember", symbol: "↺" },
  ],
} as const satisfies MomentInteractionViewModel;

function momentDetail(
  detail: MomentConversationViewModel,
): MomentConversationViewModel {
  return detail;
}

const composerPeople = [
  {
    id: "brian",
    name: "Brian",
    initial: "B",
    accent: "teal",
    contextLabel: "You",
  },
  {
    id: "molly",
    name: "Molly",
    initial: "M",
    accent: "clay",
    contextLabel: "Co-organizer",
  },
  {
    id: "avery",
    name: "Avery",
    initial: "A",
    accent: "ochre",
    contextLabel: "Child",
  },
  {
    id: "sam",
    name: "Sam",
    initial: "S",
    accent: "slate",
    contextLabel: "Child",
  },
  {
    id: "june",
    name: "June",
    initial: "J",
    accent: "moss",
    contextLabel: "Child",
  },
] as const;

const composerJournalPeople = composerPeople.filter(
  (person) => person.id !== "molly",
);

function chrome(
  accent: AccentToken,
  title: string,
  defaultJournalPersonId = "brian",
): JournalChromeViewModel {
  return {
    accent,
    title,
    eyebrow: "Our family",
    familyMark,
    notifications: [
      {
        id: "preview-note-molly",
        actorName: "Molly",
        message: "commented on your photo.",
        displayDate: "Today",
        href: "/family#moment-sunset",
      },
      {
        id: "preview-reaction-molly",
        actorName: "Molly",
        message: "loved your photo.",
        displayDate: "Today",
        href: "/family#moment-sunset",
      },
    ],
    composer: {
      previewToday: "2026-08-28",
      defaultJournalPersonId,
      recorderPersonId: "brian",
      recordedByName: "Brian",
      journalPeople: composerJournalPeople,
      taggablePeople: composerPeople,
    },
  };
}

const familyEntries = [
  { id: "today", entryType: "date-marker", label: "Today" },
  {
    id: "sunset",
    entryType: "moment",
    moment: {
      id: "sunset",
      journalPersonId: "brian",
      kind: "photo",
      personName: "Brian",
      personInitial: "B",
      personAccent: "teal",
      displayTime: "8:14 pm",
      displayDate: "Aug 28, 2026",
      occurredOn: "2026-08-28",
      kicker: "An ordinary Friday",
      text: "We stayed until the light disappeared. Nobody wanted to be the first one back in the car.",
      conversation: momentDetail({
        notes: [
          {
            id: "sunset-note-molly",
            authorName: "Molly",
            authorInitial: "M",
            authorAccent: "clay",
            body: "The quiet ride home was my favorite part.",
            displayDate: "Aug 29, 2026",
          },
          {
            id: "sunset-note-brian",
            authorName: "Brian",
            authorInitial: "B",
            authorAccent: "teal",
            body: "I can still hear everyone laughing by the water.",
            displayDate: "Aug 30, 2026",
          },
        ],
        reactions: [
          {
            id: "sunset-reaction-molly",
            personName: "Molly",
            personInitial: "M",
            personAccent: "clay",
            reactionId: "held-close",
          },
        ],
      }),
      image: {
        src: "/sample-family.jpg",
        alt: "A child laughing outside in warm evening light",
        badgeLabel: "AUG 28",
      },
      taggedPeopleLabel: "Molly + 3",
    },
  },
  {
    id: "kitchen",
    entryType: "moment",
    moment: {
      id: "kitchen",
      journalPersonId: "molly",
      kind: "thought",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "9:42 pm",
      displayDate: "Aug 14, 2026",
      occurredOn: "2026-08-14",
      kicker: "A thought",
      text: "Tonight the kitchen was loud, the floor was a mess, and I wished I could keep all of it.",
      conversation: momentDetail({
        notes: [
          {
            id: "kitchen-note-brian",
            authorName: "Brian",
            authorInitial: "B",
            authorAccent: "teal",
            body: "I wrote this down because I knew I would miss the noise.",
            displayDate: "Aug 15, 2026",
          },
        ],
        reactions: [],
      }),
    },
  },
  {
    id: "lake",
    entryType: "moment",
    moment: {
      id: "lake",
      journalPersonId: "molly",
      kind: "location",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "4:08 pm",
      displayDate: "Jul 6, 2026",
      occurredOn: "2026-07-06",
      kicker: "A place we’ll remember",
      text: "The small beach past the pine trees, where Avery finally put both feet in the water.",
      conversation: momentDetail({
        notes: [
          {
            id: "lake-note-brian",
            authorName: "Brian",
            authorInitial: "B",
            authorAccent: "teal",
            body: "Those wet shoes stayed by the door for days.",
            displayDate: "Jul 7, 2026",
          },
        ],
        reactions: [],
      }),
      place: "Sand Harbor · Lake Tahoe",
      mapLabel: "TAHOE",
      taggedPeopleLabel: "Avery",
    },
  },
  { id: "year-2023", entryType: "date-marker", label: "2023", divider: true },
  {
    id: "first-day",
    entryType: "moment",
    moment: {
      id: "first-day",
      journalPersonId: "avery",
      kind: "milestone",
      personName: "Avery",
      personInitial: "A",
      personAccent: "ochre",
      displayTime: undefined,
      displayDate: "Aug 21, 2023",
      occurredOn: "2023-08-21",
      kicker: "Milestone",
      text: "A backpack almost as big as Avery, one brave wave, and then straight through the blue door.",
      conversation: momentDetail({
        notes: [
          {
            id: "first-day-note-brian",
            authorName: "Brian",
            authorInitial: "B",
            authorAccent: "teal",
            body: "That brave wave still gets me.",
            displayDate: "Aug 21, 2023",
          },
        ],
        reactions: [
          {
            id: "first-day-reaction-molly",
            personName: "Molly",
            personInitial: "M",
            personAccent: "clay",
            reactionId: "made-me-smile",
          },
        ],
      }),
      milestone: "First day of school",
      ageLabel: "Age 5",
      yearLabel: "2023",
    },
  },
  { id: "year-2022", entryType: "date-marker", label: "2022", divider: true },
  {
    id: "late-summer-2022",
    entryType: "moment",
    moment: {
      id: "late-summer-2022",
      journalPersonId: "brian",
      kind: "photo",
      personName: "Brian",
      personInitial: "B",
      personAccent: "teal",
      displayTime: "6:31 pm",
      displayDate: "Aug 28, 2022",
      occurredOn: "2022-08-28",
      kicker: "A late-summer afternoon",
      text: "Peaches on the porch, grass-stained knees, and the last warm hour before dinner.",
      conversation: momentDetail({ notes: [], reactions: [] }),
      image: {
        src: "/sample-family.jpg",
        alt: "A child laughing outside in late-summer light",
        badgeLabel: "AUG 28",
      },
      taggedPeopleLabel: "Molly + 3",
    },
  },
  { id: "year-2019", entryType: "date-marker", label: "2019", divider: true },
  {
    id: "porch-light-2019",
    entryType: "moment",
    moment: {
      id: "porch-light-2019",
      journalPersonId: "molly",
      kind: "thought",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "9:17 pm",
      displayDate: "Aug 28, 2019",
      occurredOn: "2019-08-28",
      kicker: "A thought",
      text: "The porch light came on before anyone noticed summer was getting shorter.",
      conversation: momentDetail({ notes: [], reactions: [] }),
    },
  },
  {
    id: "earlier-years",
    entryType: "end-message",
    markerLabel: "Earlier years",
    message: "Keep scrolling to travel back through your family’s life.",
  },
] as const satisfies readonly TimelineEntryViewModel[];

export function getFamilyTimelineFixture(): TimelineViewModel {
  const moments = (familyEntries as readonly TimelineEntryViewModel[])
    .filter(isMomentEntry)
    .map((entry) => entry.moment);

  return {
    chrome: chrome("teal", "All our days"),
    interaction: timelineInteraction,
    switcher: [
      { label: "Family", href: "/family", current: true },
      { label: "Molly", href: "/people/molly", current: false },
    ],
    entries: buildTimelineEntries(
      moments,
      designPreviewToday,
      false,
      undefined,
      {
        markerLabel: "Earlier years",
        message: "Keep scrolling to travel back through your family’s life.",
      },
    ),
  };
}

const personalJournals = [
  {
    id: "brian",
    name: "Brian",
    initial: "B",
    accent: "teal",
    composerJournalPersonId: "brian",
  },
  {
    id: "molly",
    name: "Molly",
    initial: "M",
    accent: "clay",
    composerJournalPersonId: "brian",
  },
  {
    id: "avery",
    name: "Avery",
    initial: "A",
    accent: "ochre",
    composerJournalPersonId: "avery",
  },
  {
    id: "sam",
    name: "Sam",
    initial: "S",
    accent: "slate",
    composerJournalPersonId: "sam",
  },
  {
    id: "june",
    name: "June",
    initial: "J",
    accent: "moss",
    composerJournalPersonId: "june",
  },
] as const satisfies readonly Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  composerJournalPersonId: string;
}>[];

type PersonalJournal = (typeof personalJournals)[number];

function personalTimelineEntries(
  person: PersonalJournal,
): readonly TimelineEntryViewModel[] {
  const moments = (familyEntries as readonly TimelineEntryViewModel[])
    .filter(isMomentEntry)
    .filter((entry) => entry.moment.journalPersonId === person.id)
    .toSorted((left, right) =>
      compareMemoryDatesDescending(left.moment, right.moment),
    );

  if (moments.length === 0) {
    return [
      {
        id: `${person.id}-ready`,
        entryType: "end-message",
        markerLabel: "A story ready to begin",
        message: `The first moment your family keeps for ${person.name} will begin this timeline.`,
      },
    ];
  }

  return buildTimelineEntries(
    moments.map((entry) => entry.moment),
    designPreviewToday,
    false,
    person.name,
    moments.length === 1
      ? {
          markerLabel: "The story so far",
          message: `This is the earliest moment kept for ${person.name}.`,
        }
      : {
          markerLabel: "Earlier years",
          message: "Keep scrolling to travel back through this life.",
        },
  );
}

function personalSummary(entries: readonly TimelineEntryViewModel[]): string {
  const moments = entries.filter(isMomentEntry);
  if (moments.length === 0) return "No moments yet";
  const newestYear = moments[0].moment.occurredOn.slice(0, 4);
  const oldestYear = moments[moments.length - 1].moment.occurredOn.slice(0, 4);
  const years =
    newestYear === oldestYear ? newestYear : `${oldestYear}–${newestYear}`;
  return `${moments.length} ${moments.length === 1 ? "moment" : "moments"} · ${years}`;
}

export function getPersonalTimelineFixture(
  personId: string,
): TimelineViewModel | null {
  const person = personalJournals.find(
    (candidate) => candidate.id === personId,
  );
  if (!person) return null;
  const entries = personalTimelineEntries(person);

  return {
    chrome: chrome(
      person.accent,
      `${person.name}’s days`,
      person.composerJournalPersonId,
    ),
    interaction: timelineInteraction,
    switcher: [
      { label: "Family", href: "/family", current: false },
      {
        label: person.name,
        href: `/people/${person.id}`,
        current: true,
      },
    ],
    timelineLabel: `Chronological moments for ${person.name}`,
    personalIntro: {
      initial: person.initial,
      accent: person.accent,
      title: `${person.name}’s journal`,
      summary: personalSummary(entries),
    },
    entries,
  };
}

export function getPeopleFixture(): PeopleViewModel {
  return {
    chrome: chrome("teal", "Our people"),
    intro: "Individual journals within this family archive.",
    people: [
      {
        id: "brian",
        name: "Brian",
        initial: "B",
        accent: "teal",
        roleLabel: "Co-organizer",
        journalHref: "/people/brian",
      },
      {
        id: "molly",
        name: "Molly",
        initial: "M",
        accent: "clay",
        roleLabel: "Co-organizer",
        journalHref: "/people/molly",
      },
      {
        id: "avery",
        name: "Avery",
        initial: "A",
        accent: "ochre",
        roleLabel: "Managed profile · No sign-in",
        journalHref: "/people/avery",
      },
      {
        id: "sam",
        name: "Sam",
        initial: "S",
        accent: "slate",
        roleLabel: "Managed profile · No sign-in",
        journalHref: "/people/sam",
      },
      {
        id: "june",
        name: "June",
        initial: "J",
        accent: "moss",
        roleLabel: "Managed profile · No sign-in",
        journalHref: "/people/june",
      },
    ],
  };
}

export function getFamilySettingsFixture(): FamilySettingsViewModel {
  return {
    chrome: chrome("teal", "Account"),
    panel: {
      mode: "preview",
      intro:
        "A small, invitation-only circle. Everyone’s place and access should stay easy to understand.",
      currentMemberId: "brian",
      members: [
        {
          id: "brian",
          membershipId: "preview-brian-membership",
          profileKind: "account",
          role: "organizer",
          name: "Brian",
          initial: "B",
          accent: "teal",
          relationshipLabel: "Co-organizer",
          accessLabel: "Account · Can sign in",
          guardianMembershipIds: [],
          canManageRole: false,
          canManageJournal: false,
          canReviewRemoval: false,
        },
        {
          id: "molly",
          membershipId: "preview-molly-membership",
          profileKind: "account",
          role: "organizer",
          name: "Molly",
          initial: "M",
          accent: "clay",
          relationshipLabel: "Co-organizer",
          accessLabel: "Account · Can sign in",
          guardianMembershipIds: [],
          canManageRole: false,
          canManageJournal: false,
          canReviewRemoval: true,
        },
        {
          id: "avery",
          membershipId: null,
          profileKind: "managed",
          role: null,
          name: "Avery",
          initial: "A",
          accent: "ochre",
          relationshipLabel: "Child journal",
          accessLabel: "Managed profile · No sign-in",
          guardianMembershipIds: [],
          canManageRole: false,
          canManageJournal: false,
          canReviewRemoval: false,
        },
        {
          id: "sam",
          membershipId: null,
          profileKind: "managed",
          role: null,
          name: "Sam",
          initial: "S",
          accent: "slate",
          relationshipLabel: "Child journal",
          accessLabel: "Managed profile · No sign-in",
          guardianMembershipIds: [],
          canManageRole: false,
          canManageJournal: false,
          canReviewRemoval: false,
        },
        {
          id: "june",
          membershipId: null,
          profileKind: "managed",
          role: null,
          name: "June",
          initial: "J",
          accent: "moss",
          relationshipLabel: "Child journal",
          accessLabel: "Managed profile · No sign-in",
          guardianMembershipIds: [],
          canManageRole: false,
          canManageJournal: false,
          canReviewRemoval: false,
        },
      ],
    },
  };
}

type MomentEntry = Extract<
  TimelineEntryViewModel,
  Readonly<{ entryType: "moment" }>
>;

function isMomentEntry(entry: TimelineEntryViewModel): entry is MomentEntry {
  return entry.entryType === "moment";
}

const archiveMoments = (familyEntries as readonly TimelineEntryViewModel[])
  .filter(isMomentEntry)
  .sort((left, right) =>
    compareMemoryDatesDescending(left.moment, right.moment),
  );
const designPreviewToday = "2026-08-28";
const designPreviewAnniversary = anniversaryKey(designPreviewToday);

function availableMemoryYears() {
  return [
    ...new Set(
      archiveMoments.map((entry) => entry.moment.occurredOn.slice(0, 4)),
    ),
  ];
}

export function getMemoriesFixture(): MemoriesViewModel {
  const anniversaryMoments = archiveMoments.filter((entry) =>
    matchesAnniversary(entry.moment.occurredOn, designPreviewAnniversary),
  );
  const featured = anniversaryMoments.find(
    (entry) => entry.moment.id === "late-summer-2022",
  )?.moment;
  if (!featured || featured.kind !== "photo") {
    throw new Error("The Memories design preview requires its featured photo.");
  }

  return {
    chrome: chrome("teal", "Memories"),
    heading: "On this day",
    subheading: "This date across years",
    feature: {
      state: "photo",
      href: "/memories/on-this-day",
      imageSrc: featured.image.src,
      imageAlt: featured.image.alt,
      dateLabel: featured.displayDate,
      title: featured.kicker,
      actionLabel: `View ${anniversaryMoments.length} entries →`,
    },
    years: availableMemoryYears().map((year) => ({
      year,
      href: `/memories/years/${year}`,
      ariaLabel: `Browse memories from ${year}`,
    })),
  };
}

export function getOnThisDayFixture(
  monthAndDay: string,
): MemoryJourneyViewModel {
  const memoriesChrome = chrome("teal", "Memories");
  const moments = archiveMoments.filter((entry) =>
    matchesAnniversary(entry.moment.occurredOn, monthAndDay),
  );
  const base = {
    chrome: memoriesChrome,
    returnHref: "/memories",
    returnLabel: "All memories",
    eyebrow: "On this day · Prior years",
    title: formatAnniversaryLabel(monthAndDay),
    description: "Entries recorded on this date in prior years.",
  } as const;

  if (moments.length === 0) {
    return {
      ...base,
      state: "empty",
      emptyState: {
        title: "No entries for this date",
        description: "Entries from this date will appear here.",
      },
    };
  }

  const entries: TimelineEntryViewModel[] = [];
  moments.forEach((moment, index) => {
    if (index > 0) {
      entries.push({
        id: `on-this-day-gap-${index}`,
        entryType: "elapsed-gap",
        label: elapsedCalendarLabel(
          moments[index - 1].moment.occurredOn,
          moment.moment.occurredOn,
        ),
      });
    }
    entries.push({
      id: `on-this-day-${moment.moment.id}`,
      entryType: "date-marker",
      label: moment.moment.displayDate,
    });
    entries.push(moment);
  });
  entries.push({
    id: "on-this-day-end",
    entryType: "end-message",
    markerLabel: "Across the years",
    message: "Small days, held here for the years ahead.",
  });

  return {
    ...base,
    state: "moments",
    timeline: {
      chrome: memoriesChrome,
      interaction: timelineInteraction,
      switcher: [],
      entries,
    },
  };
}

export function getDesignPreviewOnThisDayFixture() {
  return getOnThisDayFixture(designPreviewAnniversary);
}

export function getMilestoneMemoriesFixture(): MemoryJourneyViewModel {
  const memoriesChrome = chrome("teal", "Memories");
  const moments = archiveMoments.filter(
    (entry) => entry.moment.kind === "milestone",
  );
  const base = {
    chrome: memoriesChrome,
    returnHref: "/memories",
    returnLabel: "All memories",
    eyebrow: "Family milestones",
    title: "Milestones",
    description: "Firsts, changes, and new chapters, held in their true order.",
  } as const;

  if (moments.length === 0) {
    return {
      ...base,
      state: "empty",
      emptyState: {
        title: "No milestones have been marked yet",
        description:
          "Milestones added to the family journal will gather here in their true order.",
      },
    };
  }

  const entries: TimelineEntryViewModel[] = [];
  moments.forEach((moment, index) => {
    if (index > 0) {
      entries.push({
        id: `milestones-gap-${index}`,
        entryType: "elapsed-gap",
        label: elapsedCalendarLabel(
          moments[index - 1].moment.occurredOn,
          moment.moment.occurredOn,
        ),
      });
    }
    entries.push({
      id: `milestones-${moment.moment.id}`,
      entryType: "date-marker",
      label: moment.moment.displayDate,
    });
    entries.push(moment);
  });
  entries.push({
    id: "milestones-end",
    entryType: "end-message",
    markerLabel: "Milestones through the years",
    message: "Turning points, held beside all the ordinary days.",
  });

  return {
    ...base,
    state: "moments",
    timeline: {
      chrome: memoriesChrome,
      interaction: timelineInteraction,
      switcher: [],
      timelineLabel: "Family milestones in reverse chronological order",
      entries,
    },
  };
}

export function getYearMemoriesFixture(
  year: string,
): MemoryJourneyViewModel | null {
  if (!availableMemoryYears().includes(year)) return null;

  const memoriesChrome = chrome("teal", "Memories");
  const moments = archiveMoments.filter((entry) =>
    entry.moment.occurredOn.startsWith(`${year}-`),
  );
  const entries: TimelineEntryViewModel[] = [
    { id: `year-${year}`, entryType: "date-marker", label: year },
  ];

  moments.forEach((moment, index) => {
    if (index > 0) {
      entries.push({
        id: `${year}-gap-${index}`,
        entryType: "elapsed-gap",
        label: elapsedCalendarLabel(
          moments[index - 1].moment.occurredOn,
          moment.moment.occurredOn,
        ),
      });
    }
    entries.push(moment);
  });
  entries.push({
    id: `${year}-end`,
    entryType: "end-message",
    markerLabel: `End of ${year}`,
    message: "Every year becomes a chapter in the family’s story.",
  });

  const momentWord = moments.length === 1 ? "moment" : "moments";
  return {
    chrome: memoriesChrome,
    returnHref: "/memories",
    returnLabel: "All memories",
    eyebrow: "Browse by year",
    title: year,
    description: `${moments.length} ${momentWord} from this chapter of family life.`,
    state: "moments",
    timeline: {
      chrome: memoriesChrome,
      interaction: timelineInteraction,
      switcher: [],
      entries,
    },
  };
}
