import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TimelineFeed } from "./timeline-feed";
import type { TimelineViewModel } from "./timeline-view-model";

const shared = {
  personName: "Person",
  personInitial: "P",
  personAccent: "teal",
  displayTime: "8:00 pm",
  displayDate: "Aug 1, 2026",
  occurredOn: "2026-08-01",
  kicker: "Memory",
  text: "Worth keeping.",
  conversation: {
    notes: [
      {
        id: "note",
        authorName: "Other person",
        authorInitial: "O",
        authorAccent: "clay",
        body: "A private detail.",
        displayDate: "Aug 2, 2026",
      },
    ],
    reactions: [],
  },
} as const;

const interaction = {
  currentPerson: { name: "Person", initial: "P", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Hold close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "✦" },
    { id: "remember-this", label: "I remember", symbol: "↺" },
  ],
} as const;

const composer = {
  previewToday: "2026-08-28",
  currentJournalPersonId: "person",
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

const model = {
  chrome: {
    accent: "teal",
    title: "Days",
    eyebrow: "Family",
    composer,
    familyMark: [{ id: "person", initial: "P", accent: "teal" }],
  },
  interaction,
  switcher: [{ label: "Family", href: "/family", current: true }],
  entries: [
    { id: "marker", entryType: "date-marker", label: "Today" },
    {
      id: "photo",
      entryType: "moment",
      moment: {
        ...shared,
        id: "photo-moment",
        kind: "photo",
        image: {
          src: "/sample-family.jpg",
          alt: "Family outside",
          badgeLabel: "AUG 1",
        },
      },
    },
    { id: "gap", entryType: "elapsed-gap", label: "one week earlier" },
    {
      id: "thought",
      entryType: "moment",
      moment: { ...shared, id: "thought-moment", kind: "thought" },
    },
    {
      id: "location",
      entryType: "moment",
      moment: {
        ...shared,
        id: "location-moment",
        kind: "location",
        place: "The lake",
        mapLabel: "LAKE",
      },
    },
    {
      id: "milestone",
      entryType: "moment",
      moment: {
        ...shared,
        id: "milestone-moment",
        kind: "milestone",
        milestone: "First step",
        ageLabel: "Age 1",
        yearLabel: "2026",
      },
    },
    {
      id: "end",
      entryType: "end-message",
      markerLabel: "Earlier years",
      message: "Keep scrolling.",
    },
  ],
} as const satisfies TimelineViewModel;

describe("TimelineFeed", () => {
  it("renders the rail sequence and all four moment treatments semantically", () => {
    const { container } = render(<TimelineFeed model={model} />);
    expect(
      screen.getByLabelText("Chronological family moments"),
    ).toBeInTheDocument();
    expect(container.querySelector(".time-rail")).toBeInTheDocument();
    expect(container.querySelectorAll("article")).toHaveLength(4);
    expect(
      [...container.querySelectorAll("[data-moment-kind]")].map((node) =>
        node.getAttribute("data-moment-kind"),
      ),
    ).toEqual(["photo", "thought", "location", "milestone"]);
    expect(screen.getAllByText("one week earlier")).toHaveLength(1);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-08-01",
    );
    expect(screen.getByAltText("Family outside")).toBeInTheDocument();
  });

  it("opens the one private response surface without card totals", async () => {
    const user = userEvent.setup();
    render(<TimelineFeed model={model} />);
    expect(screen.queryByText("A private detail.")).toBeNull();
    expect(screen.queryByText(/2 notes/u)).toBeNull();

    const respond = screen.getAllByRole("button", {
      name: "Respond to Memory by Person",
    })[0];
    await user.click(respond);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("A private detail.")).toBeInTheDocument();
    expect(
      screen.getByText(/Notes and reactions are not saved/u),
    ).toBeInTheDocument();
  });
});
