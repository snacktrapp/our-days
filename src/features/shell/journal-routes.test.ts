import { describe, expect, it } from "vitest";
import {
  pathWithoutSearch,
  sectionFromPathname,
  skeletonKindFromPathname,
  withCircleBrowseContext,
} from "./journal-routes";

describe("journal routes", () => {
  it("keeps the directory return context while loading older personal entries", () => {
    expect(
      withCircleBrowseContext("/people/brian?pages=2&snapshot=now", "family"),
    ).toBe("/people/brian?pages=2&snapshot=now&fromCircle=family");
    expect(withCircleBrowseContext("/people/brian?pages=2")).toBe(
      "/people/brian?pages=2",
    );
  });
  it("keeps personal journals on Home and treats /people as Account", () => {
    expect(sectionFromPathname("/people/molly")).toBe("timeline");
    expect(skeletonKindFromPathname("/people/molly")).toBe("timeline");
    expect(sectionFromPathname("/people")).toBe("circles");
    expect(skeletonKindFromPathname("/people")).toBe("people");
    expect(sectionFromPathname("/circles")).toBe("circles");
    expect(sectionFromPathname("/family?circle=family")).toBe("circles");
    expect(sectionFromPathname("/people/brian?fromCircle=family")).toBe(
      "circles",
    );
    expect(skeletonKindFromPathname("/family?pages=2")).toBe("timeline");
    expect(pathWithoutSearch("/family?pages=2")).toBe("/family");
  });
});
