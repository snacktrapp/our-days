import { describe, expect, it } from "vitest";
import {
  defaultWiderCircleSourceId,
  formatWiderCircleIncludes,
  isWiderCircleNameSuggestion,
  readWiderCircleForm,
  suggestWiderCircleName,
} from "./wider-circle";

describe("wider circle naming", () => {
  it("suggests the start-from name plus grandparents", () => {
    expect(suggestWiderCircleName("All our days")).toBe(
      "All our days + grandparents",
    );
  });

  it("recognizes the current suggestion so edits are not overwritten", () => {
    expect(
      isWiderCircleNameSuggestion(
        "All our days + grandparents",
        "All our days",
      ),
    ).toBe(true);
    expect(isWiderCircleNameSuggestion("Cousins", "All our days")).toBe(false);
  });

  it("lists included people as one read-only line", () => {
    expect(
      formatWiderCircleIncludes(["Current person", "Other organizer"]),
    ).toBe("Includes Current person, Other organizer…");
    expect(formatWiderCircleIncludes([])).toBe("");
  });
});

describe("wider circle default source", () => {
  it("picks the circle with the most members", () => {
    expect(
      defaultWiderCircleSourceId([
        { id: "cousins", memberCount: 2 },
        { id: "family", memberCount: 6 },
        { id: "neighbors", memberCount: 3 },
      ]),
    ).toBe("family");
  });

  it("keeps a preferred circle only when it is already the largest", () => {
    expect(
      defaultWiderCircleSourceId(
        [
          { id: "a", memberCount: 4 },
          { id: "b", memberCount: 4 },
        ],
        "b",
      ),
    ).toBe("b");
    expect(
      defaultWiderCircleSourceId(
        [
          { id: "small", memberCount: 1 },
          { id: "large", memberCount: 5 },
        ],
        "small",
      ),
    ).toBe("large");
  });
});

describe("wider circle form", () => {
  it("reads the name and the explicit start-from circle", () => {
    const formData = new FormData();
    formData.set("name", "Cousins");
    formData.set("sourceCircleId", "family");

    expect(readWiderCircleForm(formData)).toEqual({
      name: "Cousins",
      sourceCircleId: "family",
    });
  });
});
