import "server-only";

import type {
  TimelineEntryViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "@/features/memories/memories-view-model";
import type { PeopleViewModel } from "@/features/people/people-view-model";
import type {
  AccentToken,
  JournalChromeViewModel,
} from "@/features/shell/shell-view-model";
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

function chrome(accent: AccentToken, title: string): JournalChromeViewModel {
  return { accent, title, eyebrow: "Our family", familyMark };
}

const familyEntries = [
  { id: "today", entryType: "date-marker", label: "Today" },
  {
    id: "sunset",
    entryType: "moment",
    moment: {
      id: "sunset",
      kind: "photo",
      personName: "Brian",
      personInitial: "B",
      personAccent: "teal",
      displayTime: "8:14 pm",
      displayDate: "Aug 28, 2026",
      occurredOn: "2026-08-28",
      kicker: "An ordinary Friday",
      text: "We stayed until the light disappeared. Nobody wanted to be the first one back in the car.",
      noteCount: 2,
      image: {
        src: "/sample-family.jpg",
        alt: "A child laughing outside in warm evening light",
        badgeLabel: "AUG 28",
      },
      taggedPeopleLabel: "Molly + 3",
    },
  },
  {
    id: "two-weeks",
    entryType: "elapsed-gap",
    label: elapsedCalendarLabel("2026-08-28", "2026-08-14"),
  },
  {
    id: "kitchen",
    entryType: "moment",
    moment: {
      id: "kitchen",
      kind: "thought",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "9:42 pm",
      displayDate: "Aug 14, 2026",
      occurredOn: "2026-08-14",
      kicker: "A thought",
      text: "Tonight the kitchen was loud, the floor was a mess, and I wished I could keep all of it.",
      noteCount: 4,
    },
  },
  {
    id: "five-weeks",
    entryType: "elapsed-gap",
    label: elapsedCalendarLabel("2026-08-14", "2026-07-06"),
  },
  {
    id: "lake",
    entryType: "moment",
    moment: {
      id: "lake",
      kind: "location",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "4:08 pm",
      displayDate: "Jul 6, 2026",
      occurredOn: "2026-07-06",
      kicker: "A place we’ll remember",
      text: "The small beach past the pine trees, where Avery finally put both feet in the water.",
      noteCount: 1,
      place: "Sand Harbor · Lake Tahoe",
      mapLabel: "TAHOE",
      taggedPeopleLabel: "Avery",
    },
  },
  {
    id: "three-years",
    entryType: "elapsed-gap",
    label: elapsedCalendarLabel("2026-07-06", "2023-08-21"),
  },
  { id: "year-2023", entryType: "date-marker", label: "2023", divider: true },
  {
    id: "first-day",
    entryType: "moment",
    moment: {
      id: "first-day",
      kind: "milestone",
      personName: "Avery",
      personInitial: "A",
      personAccent: "ochre",
      displayTime: "Added by Molly",
      displayDate: "Aug 21, 2023",
      occurredOn: "2023-08-21",
      kicker: "Milestone",
      text: "A backpack almost as big as Avery, one brave wave, and then straight through the blue door.",
      noteCount: 6,
      milestone: "First day of school",
      ageLabel: "Age 5",
      yearLabel: "2023",
    },
  },
  {
    id: "one-year",
    entryType: "elapsed-gap",
    label: elapsedCalendarLabel("2023-08-21", "2022-08-28"),
  },
  { id: "year-2022", entryType: "date-marker", label: "2022", divider: true },
  {
    id: "late-summer-2022",
    entryType: "moment",
    moment: {
      id: "late-summer-2022",
      kind: "photo",
      personName: "Brian",
      personInitial: "B",
      personAccent: "teal",
      displayTime: "6:31 pm",
      displayDate: "Aug 28, 2022",
      occurredOn: "2022-08-28",
      kicker: "A late-summer afternoon",
      text: "Peaches on the porch, grass-stained knees, and the last warm hour before dinner.",
      noteCount: 0,
      image: {
        src: "/sample-family.jpg",
        alt: "A child laughing outside in late-summer light",
        badgeLabel: "AUG 28",
      },
      taggedPeopleLabel: "Molly + 3",
    },
  },
  {
    id: "three-more-years",
    entryType: "elapsed-gap",
    label: elapsedCalendarLabel("2022-08-28", "2019-08-28"),
  },
  { id: "year-2019", entryType: "date-marker", label: "2019", divider: true },
  {
    id: "porch-light-2019",
    entryType: "moment",
    moment: {
      id: "porch-light-2019",
      kind: "thought",
      personName: "Molly",
      personInitial: "M",
      personAccent: "clay",
      displayTime: "9:17 pm",
      displayDate: "Aug 28, 2019",
      occurredOn: "2019-08-28",
      kicker: "A thought",
      text: "The porch light came on before anyone noticed summer was getting shorter.",
      noteCount: 0,
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
  return {
    chrome: chrome("teal", "All our days"),
    switcher: [
      { label: "Family", href: "/family", current: true },
      { label: "Molly", href: "/people/molly", current: false },
    ],
    entries: familyEntries,
  };
}

export function getPersonalTimelineFixture(
  personId: string,
): TimelineViewModel | null {
  if (personId !== "molly") return null;

  return {
    chrome: chrome("clay", "Molly’s days"),
    switcher: [
      { label: "Family", href: "/family", current: false },
      { label: "Molly", href: "/people/molly", current: true },
    ],
    personalIntro: {
      initial: "M",
      accent: "clay",
      title: "Molly’s journal",
      summary: "104 moments · 2012–2026",
    },
    entries: [
      { id: "summer-2026", entryType: "date-marker", label: "Summer 2026" },
      ...familyEntries.filter(
        (entry) =>
          entry.entryType === "moment" && entry.moment.personName === "Molly",
      ),
      {
        id: "earlier-years",
        entryType: "end-message",
        markerLabel: "Earlier years",
        message: "Keep scrolling to travel back through this life.",
      },
    ],
  };
}

export function getPeopleFixture(): PeopleViewModel {
  return {
    chrome: chrome("teal", "Our people"),
    intro: "Five lives, held together. Each person has a journal of their own.",
    people: [
      {
        id: "brian",
        name: "Brian",
        initial: "B",
        accent: "teal",
        roleLabel: "Co-organizer",
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
        roleLabel: "Journal profile",
      },
      {
        id: "sam",
        name: "Sam",
        initial: "S",
        accent: "slate",
        roleLabel: "Journal profile",
      },
      {
        id: "june",
        name: "June",
        initial: "J",
        accent: "moss",
        roleLabel: "Journal profile",
      },
    ],
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
    subheading: "Across the years",
    feature: {
      href: "/memories/on-this-day",
      imageSrc: featured.image.src,
      imageAlt: featured.image.alt,
      dateLabel: featured.displayDate,
      title: featured.kicker,
      actionLabel: `See ${anniversaryMoments.length} moments from this day →`,
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
    eyebrow: "On this day · Across the years",
    title: formatAnniversaryLabel(monthAndDay),
    description: "Ordinary moments returning quietly from the family archive.",
  } as const;

  if (moments.length === 0) {
    return {
      ...base,
      state: "empty",
      emptyState: {
        title: "Nothing from this day yet",
        description:
          "As the journal grows, moments from this date will gather here.",
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
      switcher: [],
      entries,
    },
  };
}

export function getDesignPreviewOnThisDayFixture() {
  return getOnThisDayFixture(designPreviewAnniversary);
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
    timeline: { chrome: memoriesChrome, switcher: [], entries },
  };
}
