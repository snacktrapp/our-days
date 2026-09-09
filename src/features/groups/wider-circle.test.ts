import { describe, expect, it } from "vitest";
import {
  isWiderCircleNameSuggestion,
  normalizeWiderCirclePerson,
  readWiderCircleForm,
  suggestWiderCircleName,
} from "./wider-circle";

describe("wider circle naming", () => {
  it("suggests the inner name plus the first added person", () => {
    expect(suggestWiderCircleName("All our days", ["Jordan"])).toBe(
      "All our days + Jordan",
    );
  });

  it("uses an ellipsis when nobody or more than one person was added", () => {
    expect(suggestWiderCircleName("All our days", [])).toBe("All our days + …");
    expect(suggestWiderCircleName("All our days", ["Jordan", "Sue"])).toBe(
      "All our days + …",
    );
  });

  it("recognizes the current suggestion so edits are not overwritten", () => {
    expect(
      isWiderCircleNameSuggestion("All our days + Jordan", "All our days", [
        "Jordan",
      ]),
    ).toBe(true);
    expect(
      isWiderCircleNameSuggestion("Cousins", "All our days", ["Jordan"]),
    ).toBe(false);
  });
});

describe("wider circle who-else", () => {
  it("accepts a complete name and email", () => {
    expect(
      normalizeWiderCirclePerson({
        displayName: "  Jordan  ",
        email: "Jordan@example.com",
      }),
    ).toEqual({ displayName: "Jordan", email: "jordan@example.com" });
  });

  it("rejects incomplete or hostile who-else rows", () => {
    expect(
      normalizeWiderCirclePerson({ displayName: "", email: "a@b.com" }),
    ).toBeNull();
    expect(
      normalizeWiderCirclePerson({
        displayName: "Jordan",
        email: "not-an-email",
      }),
    ).toBeNull();
  });

  it("reads name, start-from, and who-else from form data", () => {
    const formData = new FormData();
    formData.set("name", "All our days + Jordan");
    formData.set("sourceCircleId", "family");
    formData.append("whoElseName", "Jordan");
    formData.append("whoElseEmail", "jordan@example.com");
    formData.append("whoElseName", "missing-email");
    formData.append("whoElseEmail", "");

    expect(readWiderCircleForm(formData)).toEqual({
      name: "All our days + Jordan",
      sourceCircleId: "family",
      whoElse: [{ displayName: "Jordan", email: "jordan@example.com" }],
    });
  });
});
