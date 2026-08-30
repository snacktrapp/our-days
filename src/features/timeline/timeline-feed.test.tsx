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
  noteCount: 2,
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

  it("keeps the reaction private and pressed-state based", async () => {
    const user = userEvent.setup();
    render(<TimelineFeed model={model} />);
    const hold = screen.getAllByRole("button", {
      name: "Hold Memory by Person",
    })[0];
    expect(hold).toHaveAttribute("aria-pressed", "false");
    await user.click(hold);
    expect(
      screen.getAllByRole("button", { name: "Release Memory by Person" })[0],
    ).toHaveAttribute("aria-pressed", "true");
  });
});
