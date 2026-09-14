import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineRefreshMemory } from "./timeline-refresh-memory";
import { journalLoadSoftFailEntryId, type TimelineViewModel } from "./timeline-view-model";

function model(overrides?: Partial<TimelineViewModel>): TimelineViewModel {
  return {
    chrome: {
      accent: "teal",
      title: "All circles",
      eyebrow: "Circles",
      composer: {
        previewToday: "2026-09-14",
        defaultJournalPersonId: "brian",
        recorderPersonId: "brian",
        recordedByName: "Brian",
        journalPeople: [],
        taggablePeople: [],
      },
      familyMark: [],
      settingsHref: "/settings/family",
      memoriesHref: "/memories",
    },
    switcher: [],
    entries: [
      {
        id: "entry-1",
        entryType: "empty-state",
        title: "Loaded timeline",
        message: "Moments are here.",
      },
    ],
    ...overrides,
  };
}

describe("TimelineRefreshMemory", () => {
  it("keeps prior timeline content on a soft-failed refresh", () => {
    const ready = model();
    const softFail = model({
      entries: [
        {
          id: journalLoadSoftFailEntryId,
          entryType: "empty-state",
          title: "These days couldn't open",
          message: "Try again in a moment. Nothing here was lost.",
        },
      ],
      paginationError: {
        retryHref: "/family",
        message: "The journal couldn't open these days just now.",
        label: "Try opening the journal again",
      },
      refreshDegraded: true,
    });

    const { rerender } = render(
      <TimelineRefreshMemory model={ready}>
        <div>Loaded moments stay visible</div>
      </TimelineRefreshMemory>,
    );
    expect(screen.getByText("Loaded moments stay visible")).toBeVisible();

    rerender(
      <TimelineRefreshMemory
        model={softFail}
        afterContent={<p role="alert">{softFail.paginationError?.message}</p>}
      >
        <div>Soft-fail placeholder</div>
      </TimelineRefreshMemory>,
    );

    expect(screen.getByText("Loaded moments stay visible")).toBeVisible();
    expect(screen.queryByText("Soft-fail placeholder")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The journal couldn't open these days just now.",
    );
  });

  it("updates retained content when a healthy refresh returns", () => {
    const first = model();
    const next = model({
      entries: [
        {
          id: "entry-2",
          entryType: "empty-state",
          title: "Updated timeline",
          message: "New moments arrived.",
        },
      ],
    });

    const { rerender } = render(
      <TimelineRefreshMemory model={first}>
        <div>First load</div>
      </TimelineRefreshMemory>,
    );
    expect(screen.getByText("First load")).toBeVisible();

    rerender(
      <TimelineRefreshMemory model={next}>
        <div>Updated load</div>
      </TimelineRefreshMemory>,
    );

    expect(screen.getByText("Updated load")).toBeVisible();
    expect(screen.queryByText("First load")).toBeNull();
  });
});
