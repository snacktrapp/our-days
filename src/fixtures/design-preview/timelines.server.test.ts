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
      "Aug 27, 2026",
      "Aug 14, 2026",
      "Jul 6, 2026",
      "Aug 21, 2023",
      "Aug 28, 2022",
      "Aug 28, 2019",
    ]);
    expect(
      getFamilyTimelineFixture().entries.some(
        (entry) => entry.entryType === "elapsed-gap",
      ),
    ).toBe(false);
    expect(
      getFamilyTimelineFixture().entries.find(
        (entry) => entry.entryType === "end-message",
      ),
    ).toMatchObject({
      entryType: "end-message",
      markerLabel: "The beginning",
    });
  });

  it("teaches the family switcher the group / person / you grammar", () => {
    const family = getFamilyTimelineFixture();
    expect(family.chrome.eyebrow).toBe("Group");
    expect(family.chrome.title).toBe("All our days");
    expect(family.switcher.map((item) => [item.kind, item.label])).toEqual([
      ["you", "Brian"],
      ["group", "All our days"],
      ["person", "Molly"],
      ["person", "Avery"],
      ["person", "Sam"],
      ["person", "June"],
    ]);

    const molly = getPersonalTimelineFixture("molly");
    expect(molly?.chrome.eyebrow).toBe("Person");
    expect(molly?.chrome.title).toBe("Molly");
    expect(molly?.switcher.find((item) => item.current)).toMatchObject({
      kind: "person",
      label: "Molly",
    });

    const brian = getPersonalTimelineFixture("brian");
    expect(brian?.chrome.eyebrow).toBe("You");
    expect(brian?.chrome.title).toBe("Brian");
  });

  it("uses the same date-marker grammar in personal journals", () => {
    const timeline = getPersonalTimelineFixture("brian");
    expect(timeline).not.toBeNull();
    const markers = markerBeforeEveryMoment(timeline!.entries);

    expect(markers.every((entry) => entry?.entryType === "date-marker")).toBe(
      true,
    );
    expect(
      timeline!.entries.some((entry) => entry.entryType === "elapsed-gap"),
    ).toBe(false);
    expect(
      timeline!.entries.find((entry) => entry.entryType === "end-message"),
    ).toMatchObject({
      entryType: "end-message",
      markerLabel: "The beginning",
    });
  });
});
