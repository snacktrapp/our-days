import { describe, expect, it } from "vitest";
import { taggablePeopleForSelectedCircles } from "./composer-view-model";

const brianHome = {
  id: "brian-gp",
  name: "Brian",
  initial: "B",
  accent: "teal" as const,
  contextLabel: "You",
};
const brianFamily = {
  id: "brian",
  name: "Brian",
  initial: "B",
  accent: "teal" as const,
  contextLabel: "You",
};
const molly = {
  id: "molly",
  name: "Molly",
  initial: "M",
  accent: "clay" as const,
  contextLabel: "Co-organizer",
};
const calvin = {
  id: "calvin",
  name: "Calvin",
  initial: "C",
  accent: "ochre" as const,
  contextLabel: "Child journal",
};

const byCircle = {
  grandparents: [brianHome],
  family: [brianFamily, molly, calvin],
};

describe("taggablePeopleForSelectedCircles", () => {
  it("keeps the Home roster for Just me", () => {
    expect(
      taggablePeopleForSelectedCircles(
        [brianHome],
        byCircle,
        ["family"],
        true,
      ).map((person) => person.id),
    ).toEqual(["brian-gp"]);
  });

  it("uses the selected Post to circle, not the Home roster", () => {
    expect(
      taggablePeopleForSelectedCircles(
        [brianHome],
        byCircle,
        ["family"],
        false,
      ).map((person) => person.id),
    ).toEqual(["brian", "molly", "calvin"]);
  });

  it("unions people across selected circles and dedupes by person id", () => {
    const sharedMolly = { ...molly };
    expect(
      taggablePeopleForSelectedCircles(
        [brianHome],
        {
          grandparents: [brianHome, sharedMolly],
          family: [brianFamily, molly, calvin],
        },
        ["grandparents", "family"],
        false,
      ).map((person) => person.id),
    ).toEqual(["brian-gp", "molly", "brian", "calvin"]);
  });

  it("falls back to the Home roster when no per-circle map is present", () => {
    expect(
      taggablePeopleForSelectedCircles(
        [brianHome, molly],
        undefined,
        ["family"],
        false,
      ).map((person) => person.id),
    ).toEqual(["brian-gp", "molly"]);
  });
});
