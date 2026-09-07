import { describe, expect, it } from "vitest";
import {
  isActiveCircleToken,
  normalizeGroupName,
} from "./active-circle-shared";

describe("active circle tokens", () => {
  it("accepts live circle ids and preview slugs", () => {
    expect(isActiveCircleToken("20000000-0000-4000-8000-000000000001")).toBe(
      true,
    );
    expect(isActiveCircleToken("created")).toBe(true);
    expect(isActiveCircleToken("family")).toBe(true);
    expect(isActiveCircleToken("../nope")).toBe(false);
  });

  it("requires a trimmed group name", () => {
    expect(normalizeGroupName("  Cousins  ")).toBe("Cousins");
    expect(normalizeGroupName("")).toBeNull();
    expect(normalizeGroupName("   ")).toBeNull();
  });
});
