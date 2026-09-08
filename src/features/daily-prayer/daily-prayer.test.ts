import { describe, expect, it } from "vitest";
import {
  dailyPrayerHasAnswers,
  dailyPrayerVerseForDate,
  dailyPrayerVerses,
  emptyDailyPrayerAnswers,
  formatDailyPrayerMoment,
  parseDailyPrayerMoment,
} from "./daily-prayer";

describe("daily prayer verses", () => {
  it("rotates scripture by calendar day and includes Ezekiel 36:26", () => {
    expect(
      dailyPrayerVerses.some((verse) => verse.reference === "Ezekiel 36:26"),
    ).toBe(true);
    const first = dailyPrayerVerseForDate("2026-09-08");
    const same = dailyPrayerVerseForDate("2026-09-08");
    const next = dailyPrayerVerseForDate("2026-09-09");
    expect(first).toEqual(same);
    expect(next.reference).not.toBe(first.reference);
  });
});

describe("daily prayer payload", () => {
  it("round-trips answers and rejects ordinary notes", () => {
    const verse = dailyPrayerVerseForDate("2026-09-08");
    const body = formatDailyPrayerMoment(verse, {
      thanks: ["sunrise", "coffee", ""],
      showUp: "Listen first.",
      prayers: ["peace", "", ""],
      affirm: "Beloved.",
    });
    const parsed = parseDailyPrayerMoment(body);
    expect(parsed).toMatchObject({
      reference: verse.reference,
      verse: verse.text,
      thanks: ["sunrise", "coffee", ""],
      showUp: "Listen first.",
      prayers: ["peace", "", ""],
      affirm: "Beloved.",
    });
    expect(parseDailyPrayerMoment("A regular thought.")).toBeNull();
    expect(dailyPrayerHasAnswers(emptyDailyPrayerAnswers)).toBe(false);
    expect(
      dailyPrayerHasAnswers({
        ...emptyDailyPrayerAnswers,
        thanks: ["one", "", ""],
      }),
    ).toBe(true);
  });
});
