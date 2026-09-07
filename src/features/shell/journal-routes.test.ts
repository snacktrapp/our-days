import { describe, expect, it } from "vitest";
import {
  pathWithoutSearch,
  sectionFromPathname,
  skeletonKindFromPathname,
} from "./journal-routes";

describe("journal routes", () => {
  it("keeps personal journals on the People tab while painting a timeline skeleton", () => {
    expect(sectionFromPathname("/people/molly")).toBe("people");
    expect(skeletonKindFromPathname("/people/molly")).toBe("timeline");
    expect(skeletonKindFromPathname("/people")).toBe("people");
    expect(skeletonKindFromPathname("/family?pages=2")).toBe("timeline");
    expect(pathWithoutSearch("/family?pages=2")).toBe("/family");
  });
});
