import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoriesPanel } from "./memories-panel";
import { MemoryJourneyPanel } from "./memory-journey-panel";
import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "./memories-view-model";

const composer = {
  previewToday: "2026-08-28",
  defaultJournalPersonId: "person",
  recorderPersonId: "person",
  recordedByName: "Person",
  journalPeople: [
    {
      id: "person",
      name: "Person",
      initial: "P",
      accent: "teal",
      contextLabel: "You",
    },
  ],
  taggablePeople: [],
} as const;

const chrome = {
  accent: "teal",
  title: "Memories",
  eyebrow: "Our family",
  composer,
  familyMark: [{ id: "person", initial: "P", accent: "teal" }],
} as const;

const interaction = {
  currentPerson: { name: "Person", initial: "P", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Hold close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "✦" },
    { id: "remember-this", label: "I remember", symbol: "↺" },
  ],
} as const;

const memories = {
  chrome,
  heading: "On this day",
  subheading: "4 years ago",
  feature: {
    href: "/memories/on-this-day",
    imageSrc: "/sample-family.jpg",
    imageAlt: "A family memory",
    dateLabel: "August 28, 2022",
    title: "A late-summer afternoon",
    actionLabel: "See 3 moments from this day →",
  },
  years: [
    {
      year: "2026",
      href: "/memories/years/2026",
      ariaLabel: "Browse memories from 2026",
    },
  ],
} as const satisfies MemoriesViewModel;

const journey = {
  chrome,
  returnHref: "/memories",
  returnLabel: "All memories",
  eyebrow: "Browse by year",
  title: "2026",
  description: "One moment from this chapter of family life.",
  state: "moments",
  timeline: {
    chrome,
    interaction,
    switcher: [],
    entries: [
      { id: "marker", entryType: "date-marker", label: "2026" },
      {
        id: "thought-entry",
        entryType: "moment",
        moment: {
          id: "thought",
          journalPersonId: "person",
          kind: "thought",
          personName: "Person",
          personInitial: "P",
          personAccent: "teal",
          displayTime: "8:00 pm",
          displayDate: "Aug 1, 2026",
          occurredOn: "2026-08-01",
          kicker: "A thought",
          text: "Worth remembering.",
          conversation: { notes: [], reactions: [] },
        },
      },
    ],
  },
} as const satisfies MemoryJourneyViewModel;

describe("Memories browsing", () => {
  it("uses real links for On This Day and available years", () => {
    render(<MemoriesPanel model={memories} />);

    expect(
      screen.getByRole("link", { name: /See 3 moments from this day/u }),
    ).toHaveAttribute("href", "/memories/on-this-day");
    expect(
      screen.getByRole("link", { name: "Browse memories from 2026" }),
    ).toHaveAttribute("href", "/memories/years/2026");
    expect(screen.queryByRole("button", { name: "2026" })).toBeNull();
  });

  it("returns from a memory journey and keeps the central timeline semantic", () => {
    const { container } = render(<MemoryJourneyPanel model={journey} />);

    expect(screen.getByRole("heading", { name: "2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All memories/u })).toHaveAttribute(
      "href",
      "/memories",
    );
    expect(
      screen.getByLabelText("Chronological family moments"),
    ).toBeInTheDocument();
    expect(container.querySelector(".time-rail")).toBeInTheDocument();
    expect(container.querySelector("#moment-thought")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Timeline view" })).toBeNull();
  });

  it("gives a quiet empty state without rendering an empty timeline rail", () => {
    render(
      <MemoryJourneyPanel
        model={{
          chrome,
          returnHref: "/memories",
          returnLabel: "All memories",
          eyebrow: "On this day",
          title: "March 4",
          description: "Memories from this date.",
          state: "empty",
          emptyState: {
            title: "Nothing from this day yet",
            description: "As the journal grows, moments will gather here.",
          },
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Nothing from this day yet" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Chronological family moments")).toBeNull();
  });
});
