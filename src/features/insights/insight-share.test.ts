import { describe, expect, it } from "vitest";
import {
  formatSharedInsightMoment,
  parseSharedInsightMoment,
} from "./insight-share";

describe("insight share payload", () => {
  it("formats a user-authored copy that still parses as a shared Insight", () => {
    const body = formatSharedInsightMoment(
      "  Prayer steadies the mind.  ",
      "  Huberman Lab — Faith and the Mind  ",
    );
    expect(parseSharedInsightMoment(body)).toEqual({
      quote: "Prayer steadies the mind.",
      attribution: "Huberman Lab — Faith and the Mind",
    });
    expect(parseSharedInsightMoment("Ordinary thought")).toBeNull();
  });
});
