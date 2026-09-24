import { describe, expect, it } from "vitest";
import { formatMomentTimeLabel } from "./moment-time-label";

const romeLunch = "2026-09-24T11:15:00.000Z";

describe("formatMomentTimeLabel", () => {
  it("keeps the clock alone when the viewer shares the poster zone", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: "2026-08-28T17:15:00Z",
        occurredTimezone: "America/Los_Angeles",
        timePrecision: "minute",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      precision: "minute",
      posterTime: "10:15 AM",
      posterDate: "2026-08-28",
      zonesDiffer: false,
    });
  });

  it("treats same-offset aliases as the viewer's zone", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: "2026-07-15T19:00:00Z",
        occurredTimezone: "America/Los_Angeles",
        timePrecision: "minute",
        viewerTimeZone: "America/Vancouver",
      }),
    ).toMatchObject({ zonesDiffer: false });
  });

  it("labels a Rome lunch for a Pacific viewer", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: romeLunch,
        occurredTimezone: "Europe/Rome",
        timePrecision: "minute",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({
      precision: "minute",
      posterTime: "1:15 PM",
      posterDate: "2026-09-24",
      zonesDiffer: true,
      placeLabel: "Rome",
      viewerTime: "4:15 AM",
      viewerDate: "2026-09-24",
    });
  });

  it("keeps the poster's date when the instant crosses midnight", () => {
    const label = formatMomentTimeLabel({
      occurredAt: "2026-09-24T22:30:00Z",
      occurredTimezone: "Europe/Rome",
      timePrecision: "minute",
      viewerTimeZone: "America/Los_Angeles",
    });
    expect(label).toMatchObject({
      precision: "minute",
      posterTime: "12:30 AM",
      posterDate: "2026-09-25",
      viewerTime: "3:30 PM",
      viewerDate: "2026-09-24",
      placeLabel: "Rome",
      zonesDiffer: true,
    });
  });

  it("hides the label on a DST edge where offsets match, and shows it when they do not", () => {
    const summer = formatMomentTimeLabel({
      occurredAt: "2026-07-15T19:00:00Z",
      occurredTimezone: "America/Phoenix",
      timePrecision: "minute",
      viewerTimeZone: "America/Los_Angeles",
    });
    expect(summer).toMatchObject({
      posterTime: "12:00 PM",
      zonesDiffer: false,
    });

    const winter = formatMomentTimeLabel({
      occurredAt: "2026-01-15T19:00:00Z",
      occurredTimezone: "America/Phoenix",
      timePrecision: "minute",
      viewerTimeZone: "America/Los_Angeles",
    });
    expect(winter).toMatchObject({
      posterTime: "12:00 PM",
      viewerTime: "11:00 AM",
      placeLabel: "Phoenix",
      zonesDiffer: true,
    });
  });

  it("names a multi-word city from the IANA zone", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: romeLunch,
        occurredTimezone: "America/New_York",
        timePrecision: "minute",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toMatchObject({ placeLabel: "New York", zonesDiffer: true });
  });

  it("falls back to the short zone name when there is no city segment", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: "2026-09-24T11:15:00Z",
        occurredTimezone: "UTC",
        timePrecision: "minute",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toMatchObject({ placeLabel: "UTC", zonesDiffer: true });
  });

  it("leaves date-only moments unchanged", () => {
    expect(
      formatMomentTimeLabel({
        occurredAt: null,
        occurredTimezone: null,
        timePrecision: "date",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({ precision: "date" });
    expect(
      formatMomentTimeLabel({
        occurredAt: romeLunch,
        occurredTimezone: "Europe/Rome",
        timePrecision: "date",
        viewerTimeZone: "America/Los_Angeles",
      }),
    ).toEqual({ precision: "date" });
  });
});
