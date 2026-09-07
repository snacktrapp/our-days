import { describe, expect, it } from "vitest";
import {
  pathWithoutSearch,
  sectionFromPathname,
  skeletonKindFromPathname,
} from "./journal-routes";

describe("journal routes", () => {
  it("keeps personal journals on Home and treats /people as Account", () => {
    expect(sectionFromPathname("/people/molly")).toBe("timeline");
    expect(skeletonKindFromPathname("/people/molly")).toBe("timeline");
    expect(sectionFromPathname("/people")).toBe("settings");
    expect(skeletonKindFromPathname("/people")).toBe("settings");
    expect(skeletonKindFromPathname("/family?pages=2")).toBe("timeline");
    expect(pathWithoutSearch("/family?pages=2")).toBe("/family");
  });
});
