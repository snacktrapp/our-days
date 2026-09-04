import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineFeed } from "./timeline-feed";
import type { TimelineViewModel } from "./timeline-view-model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const shared = {
  journalPersonId: "person",
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
  timelineLabel: "Chronological moments for Person",
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
        canChange: true,
        revision: 1,
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
  it("renders pending entries at the start of the feed, without a timeline selector", () => {
    const { container } = render(
      <TimelineFeed
        model={model}
        pendingEntries={<section data-testid="pending-entry">Adding…</section>}
      />,
    );
    const pending = screen.getByTestId("pending-entry");
    expect(container.querySelector(".view-switch")).toBeNull();
    expect(container.querySelector(".title-switcher")).toBeNull();
    expect(container.querySelector(".timeline-pull-shell")).toHaveAttribute(
      "data-pull-state",
      "idle",
    );
    expect(pending.nextElementSibling).toHaveClass("timeline");
  });

  it("does not render a person-journal banner above the feed", () => {
    render(
      <TimelineFeed
        model={{
          ...model,
          personalIntro: {
            initial: "P",
            accent: "teal",
            title: "Person’s journal",
            summary: "Chronological entries",
          },
        }}
      />,
    );
    expect(screen.queryByText("Person’s journal")).toBeNull();
    expect(screen.queryByText("Chronological entries")).toBeNull();
    expect(document.querySelector(".personal-intro")).toBeNull();
  });

  it("renders the rail sequence and all four moment treatments semantically", () => {
    const { container } = render(
      <TimelineFeed
        model={model}
        connectedActions={{
          update: vi.fn(),
          trash: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByLabelText("Chronological moments for Person"),
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
    expect(screen.getAllByText("Aug. 1, 2026 | 8:00 pm")).toHaveLength(4);
    expect(screen.queryByText("LAKE")).not.toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-moment-kind="location"] .location-card-heading .connected-moment-menu-trigger',
      ),
    ).toBeInTheDocument();
  });

  it("keeps the date but omits a timestamp when no time was recorded", () => {
    render(
      <TimelineFeed
        model={{
          ...model,
          entries: [
            {
              id: "date-only",
              entryType: "moment",
              moment: {
                ...shared,
                id: "date-only-moment",
                kind: "thought",
                displayTime: undefined,
              },
            },
          ],
        }}
      />,
    );

    expect(screen.queryByText("DATE ONLY")).not.toBeInTheDocument();
    expect(screen.getByText("Aug. 1, 2026")).toBeVisible();
  });

  it("shows entry options only on moments the viewer can change", () => {
    render(
      <TimelineFeed
        model={{
          ...model,
          entries: [
            {
              id: "owned",
              entryType: "moment",
              moment: {
                ...shared,
                id: "owned-moment",
                kind: "thought",
                canChange: true,
                revision: 3,
              },
            },
            {
              id: "family-member",
              entryType: "moment",
              moment: {
                ...shared,
                id: "family-member-moment",
                kind: "thought",
                personName: "Molly",
                canChange: false,
              },
            },
          ],
        }}
        connectedActions={{ update: vi.fn(), trash: vi.fn() }}
      />,
    );

    expect(
      screen.getAllByRole("button", { name: /^Moment options/u }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /^Moment options/u }),
    ).toHaveAccessibleName(expect.stringContaining("Person’s"));
    expect(
      screen.queryByRole("button", {
        name: /Moment options — Molly’s/u,
      }),
    ).toBeNull();
  });

  it("shows activity and opens responses inline without card totals", () => {
    render(<TimelineFeed model={model} />);
    expect(screen.getAllByText("A private detail.")).toHaveLength(4);
    expect(screen.queryByText(/2 notes/u)).toBeNull();

    const respond = screen.getAllByRole("button", {
      name: /Choose a reaction .* by Person on Aug 1, 2026/u,
    })[0];
    fireEvent.keyDown(respond, { key: "ArrowUp" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("menu", { name: "Choose a reaction" }),
    ).toBeVisible();
    expect(screen.queryByText(/Notes and reactions are not saved/u)).toBeNull();
  });

  it("keeps the timeline rail and loaded moments when an older page fails", () => {
    const failureModel: TimelineViewModel = {
      ...model,
      paginationError: {
        retryHref: "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
        message:
          "Earlier days couldn’t be opened. The moments already here are still safe.",
        label: "Try opening earlier days again",
      },
    };
    const { container } = render(<TimelineFeed model={failureModel} />);

    expect(container.querySelector(".time-rail")).toBeInTheDocument();
    expect(container.querySelectorAll("article")).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The moments already here are still safe.",
    );
    expect(
      screen.getByRole("link", { name: "Try opening earlier days again" }),
    ).toHaveAttribute(
      "href",
      "/family?pages=2&snapshot=2026-08-30T10%3A00%3A01Z",
    );
  });

  it("keeps the earliest-entry pill and omits the no-earlier-entries bar", () => {
    const { container } = render(
      <TimelineFeed
        model={{
          ...model,
          entries: [
            { id: "marker", entryType: "date-marker", label: "Today" },
            {
              id: "thought",
              entryType: "moment",
              moment: { ...shared, id: "thought-moment", kind: "thought" },
            },
            {
              id: "end",
              entryType: "end-message",
              markerLabel: "The beginning",
              message: "You’ve reached the earliest moment kept here.",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Earliest entry")).toBeVisible();
    expect(screen.queryByText("No earlier entries.")).toBeNull();
    expect(container.querySelector(".timeline-whisper")).toBeNull();
    expect(screen.getByText("Today")).toBeVisible();
  });
});
