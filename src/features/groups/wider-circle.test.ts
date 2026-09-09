import { describe, expect, it } from "vitest";
import {
  isWiderCircleNameSuggestion,
  readWiderCircleForm,
  suggestWiderCircleName,
} from "./wider-circle";

describe("wider circle naming", () => {
  it("suggests the inner name plus an ellipsis", () => {
    expect(suggestWiderCircleName("All our days")).toBe("All our days + …");
  });

  it("recognizes the current suggestion so edits are not overwritten", () => {
    expect(
      isWiderCircleNameSuggestion("All our days + …", "All our days"),
    ).toBe(true);
    expect(isWiderCircleNameSuggestion("Cousins", "All our days")).toBe(false);
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
