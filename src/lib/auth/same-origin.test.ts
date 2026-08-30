import { describe, expect, it } from "vitest";
import { isExpectedMutationOrigin } from "./same-origin";

describe("same-origin mutation boundary", () => {
  it("accepts only the exact configured origin", () => {
    expect(
      isExpectedMutationOrigin(
        "https://journal.example.com",
        "https://journal.example.com",
      ),
    ).toBe(true);
    expect(
      isExpectedMutationOrigin(
        "https://attacker.example.com",
        "https://journal.example.com",
      ),
    ).toBe(false);
    expect(
      isExpectedMutationOrigin(
        "https://journal.example.com.attacker.test",
        "https://journal.example.com",
      ),
    ).toBe(false);
  });

  it("fails closed for missing or malformed origins", () => {
    expect(isExpectedMutationOrigin(null, "https://journal.example.com")).toBe(
      false,
    );
    expect(isExpectedMutationOrigin("not a URL", undefined)).toBe(false);
  });
});
