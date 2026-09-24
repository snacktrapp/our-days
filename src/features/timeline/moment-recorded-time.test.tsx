import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatMomentTimeLabel } from "./moment-time-label";
import { MomentRecordedTime } from "./moment-recorded-time";

describe("MomentRecordedTime", () => {
  it("keeps today's timestamp when no zone was recorded", () => {
    render(
      <MomentRecordedTime occurredOn="2026-08-01" displayTime="8:00 pm" />,
    );
    expect(screen.getByText("Aug. 1, 2026 · 8:00 pm")).toBeVisible();
  });

  it("adds the poster city when the viewer zone differs", async () => {
    render(
      <MomentRecordedTime
        occurredOn="2026-09-24"
        displayTime="1:15 PM"
        occurredAt="2026-09-24T11:15:00.000Z"
        timeZone="Europe/Rome"
      />,
    );
    const label = formatMomentTimeLabel({
      occurredAt: "2026-09-24T11:15:00.000Z",
      occurredTimezone: "Europe/Rome",
      timePrecision: "minute",
      viewerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(label.precision).toBe("minute");
    if (label.precision !== "minute" || !label.viewerTime) {
      throw new Error("expected a zoned clock");
    }
    expect(await screen.findByText(/1:15 PM Rome/)).toBeVisible();
    expect(document.querySelectorAll(".moment-when-line")[1]).toHaveTextContent(
      `· ${label.viewerTime} your time`,
    );
  });
});
