import { describe, expect, it } from "vitest";
import { displayConversationDate } from "./display-conversation-date";

describe("displayConversationDate", () => {
  const now = new Date(2026, 8, 12, 15, 0, 0);

  it("uses Today with local clock time on the same calendar day", () => {
    expect(
      displayConversationDate(
        new Date(2026, 8, 12, 7, 55, 0).toISOString(),
        now,
      ),
    ).toBe("Today · 7:55 AM");
  });

  it("uses month and day with local time for another day in the same year", () => {
    expect(
      displayConversationDate(
        new Date(2026, 8, 11, 19, 4, 0).toISOString(),
        now,
      ),
    ).toBe("Sep 11 · 7:04 PM");
  });

  it("includes the year when the note is from another year", () => {
    expect(
      displayConversationDate(
        new Date(2025, 8, 12, 7, 55, 0).toISOString(),
        now,
      ),
    ).toBe("Sep 12, 2025 · 7:55 AM");
  });

  it("does not force UTC calendar parts when the local day differs", () => {
    const instant = "2026-09-13T02:55:00.000Z";
    const date = new Date(instant);
    const utcDay = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(date);
    const formatted = displayConversationDate(
      instant,
      new Date("2026-09-12T20:00:00-07:00"),
    );
    if (date.getUTCDate() !== date.getDate()) {
      expect(formatted.startsWith(utcDay)).toBe(false);
    }
    expect(formatted).toMatch(/ · \d{1,2}:\d{2} [AP]M$/u);
    expect(formatted).not.toMatch(/ago/iu);
  });
});
