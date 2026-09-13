import { describe, expect, it, vi } from "vitest";
import {
  getFamilySettingsFixture,
  getFamilyTimelineFixture,
  getPeopleFixture,
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

  it("teaches the family switcher All, Just me, Circles, and Person", () => {
    const family = getFamilyTimelineFixture();
    expect(family.chrome.eyebrow).toBe("Circles");
    expect(family.chrome.title).toBe("All circles");
    expect(family.switcher.map((item) => [item.kind, item.label])).toEqual([
      ["you", "Brian"],
      ["all", "All circles"],
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
    expect(brian?.chrome.eyebrow).toBe("Just me");
    expect(brian?.chrome.title).toBe("Brian");
  });

  it("lists every circle on People even when Home is on another group", () => {
    const people = getPeopleFixture({
      extraGroup: { id: "created", name: "Cousins" },
      selectedGroupId: "created",
    });
    expect(people.groups.map((group) => group.name)).toEqual([
      "All our days",
      "Cousins",
    ]);
    expect(people.groups[0]?.members.map((person) => person.name)).toEqual([
      "Brian",
      "Molly",
      "Avery",
      "Sam",
      "June",
    ]);
    expect(people.groups[1]?.members.map((person) => person.id)).toEqual([
      "brian",
    ]);
    expect(
      people.groups.some((group) =>
        group.members.some((person) => person.name === "TARS"),
      ),
    ).toBe(false);
    expect(people.groups[1]?.inviteHref).toContain("inviteCircle=created");
  });

  it("keeps Operations on Account tools but omits them from family counts", () => {
    const settings = getFamilySettingsFixture();
    const family = settings.panel.groups[0];
    expect(family?.members.some((member) => member.name === "TARS")).toBe(true);
    expect(family?.memberCount).toBe(
      family?.members.filter((member) => member.role !== "operations").length ??
        0,
    );
    expect(family?.memberCount).toBeLessThan(family?.members.length ?? 0);
  });

  it("adds a created group as another GROUP row and scopes its people", () => {
    const cousins = getFamilyTimelineFixture({
      extraGroup: { id: "created", name: "Cousins" },
      selectedGroupId: "created",
    });
    expect(cousins.chrome.title).toBe("Cousins");
    expect(cousins.chrome.eyebrow).toBe("Circles");
    expect(cousins.switcher.map((item) => [item.kind, item.label])).toEqual([
      ["you", "Brian"],
      ["all", "All circles"],
      ["group", "All our days"],
      ["group", "Cousins"],
      ["person", "Molly"],
      ["person", "Avery"],
      ["person", "Sam"],
      ["person", "June"],
    ]);
    expect(
      cousins.entries.filter((entry) => entry.entryType === "moment"),
    ).toEqual([]);
    expect(
      cousins.chrome.composer.taggablePeople.map((person) => person.id),
    ).toEqual(["brian"]);
    expect(
      cousins.chrome.composer.taggablePeopleByCircle?.family.map(
        (person) => person.id,
      ),
    ).toEqual(["brian", "molly", "avery", "sam", "june"]);
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
