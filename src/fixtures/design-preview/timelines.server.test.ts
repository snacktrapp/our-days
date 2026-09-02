import { describe, expect, it, vi } from "vitest";
import {
  getFamilyTimelineFixture,
  getPersonalTimelineFixture,
} from "./timelines.server";

vi.mock("server-only", () => ({}));

function markerBeforeEveryMoment(
  entries: ReturnType<typeof getFamilyTimelineFixture>["entries"],
) {
  return entries.flatMap((entry, index) =>
    entry.entryType === "moment" ? [entries[index - 1]] : [],
  );
}

describe("design preview timeline chronology", () => {
  it("uses the production date-marker grammar for every family moment", () => {
    const markers = markerBeforeEveryMoment(getFamilyTimelineFixture().entries);

    expect(markers.every((entry) => entry?.entryType === "date-marker")).toBe(
      true,
    );
    expect(
      markers.map((entry) =>
        entry?.entryType === "date-marker" ? entry.label : undefined,
      ),
    ).toEqual([
      "Today",
      "Aug 14, 2026",
      "Jul 6, 2026",
      "Aug 21, 2023",
      "Aug 28, 2022",
      "Aug 28, 2019",
    ]);
  });

  it("uses the same date-marker grammar in personal journals", () => {
    const timeline = getPersonalTimelineFixture("brian");
    expect(timeline).not.toBeNull();
    const markers = markerBeforeEveryMoment(timeline!.entries);

    expect(markers.every((entry) => entry?.entryType === "date-marker")).toBe(
      true,
    );
  });
});
