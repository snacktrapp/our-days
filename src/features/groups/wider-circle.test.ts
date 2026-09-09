import { describe, expect, it } from "vitest";
import {
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
