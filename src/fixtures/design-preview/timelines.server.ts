import "server-only";

import type {
  TimelineEntryViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type { MemoriesViewModel } from "@/features/memories/memories-view-model";
import type { PeopleViewModel } from "@/features/people/people-view-model";
import type {
  AccentToken,
  JournalChromeViewModel,
} from "@/features/shell/shell-view-model";

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
  { id: "two-weeks", entryType: "elapsed-gap", label: "two weeks earlier" },
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
  { id: "five-weeks", entryType: "elapsed-gap", label: "five weeks earlier" },
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
  { id: "three-years", entryType: "elapsed-gap", label: "three years earlier" },
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

export function getMemoriesFixture(): MemoriesViewModel {
  return {
    chrome: chrome("teal", "Memories"),
    heading: "On this day",
    subheading: "4 years ago",
    feature: {
      href: "/family",
      imageSrc: "/sample-family.jpg",
      imageAlt: "A child laughing outside",
      dateLabel: "August 28, 2022",
      title: "A late-summer afternoon",
      actionLabel: "See this moment in the timeline →",
    },
    years: ["2026", "2025", "2024", "2023"],
  };
}
