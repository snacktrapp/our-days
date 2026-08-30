import { describe, expect, it } from "vitest";
import {
  anniversaryKey,
  compareMemoryDatesDescending,
  elapsedCalendarLabel,
  formatAnniversaryLabel,
  matchesAnniversary,
} from "./memory-date";

describe("memory calendar dates", () => {
  it("matches anniversaries from date-only values without timezone conversion", () => {
    expect(anniversaryKey("2022-08-28")).toBe("08-28");
    expect(matchesAnniversary("2019-08-28", "08-28")).toBe(true);
    expect(matchesAnniversary("2019-08-27", "08-28")).toBe(false);
    expect(formatAnniversaryLabel("08-28")).toBe("August 28");
    expect(() => anniversaryKey("2022-08-28T23:00:00-07:00")).toThrow(
      "plain YYYY-MM-DD",
    );
  });

  it("keeps February 29 exact and rejects impossible dates", () => {
    expect(matchesAnniversary("2020-02-29", "02-29")).toBe(true);
    expect(matchesAnniversary("2020-02-29", "02-28")).toBe(false);
    expect(() => anniversaryKey("2021-02-29")).toThrow("real calendar date");
    expect(() => matchesAnniversary("2020-02-29", "02-30")).toThrow(
      "real calendar date",
    );
  });

  it("orders by occurrence date and then stable id", () => {
    const keys = [
      { id: "a", occurredOn: "2022-08-28" },
      { id: "c", occurredOn: "2023-01-01" },
      { id: "b", occurredOn: "2022-08-28" },
    ];
    expect(keys.sort(compareMemoryDatesDescending).map(({ id }) => id)).toEqual(
      ["c", "b", "a"],
    );
  });

  it("describes visible calendar gaps without creating Date instances", () => {
    expect(elapsedCalendarLabel("2026-08-28", "2026-08-14")).toBe(
      "2 weeks earlier",
    );
    expect(elapsedCalendarLabel("2026-08-14", "2026-07-06")).toBe(
      "one month earlier",
    );
    expect(elapsedCalendarLabel("2022-08-28", "2019-08-28")).toBe(
      "3 years earlier",
    );
    expect(() => elapsedCalendarLabel("2019-08-28", "2022-08-28")).toThrow(
      "newer to older",
    );
  });
});
