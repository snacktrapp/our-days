import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  formatMomentHeaderLabel,
  formatRecordedMomentHeader,
} from "./moment-time-label";
import { MomentRecordedTime } from "./moment-recorded-time";

describe("MomentRecordedTime", () => {
  it("keeps a one-line poster clock when no zone was recorded", () => {
    render(<MomentRecordedTime occurredOn="2026-08-01" clock="8:00 pm" />);
    expect(
      screen.getByText(
        formatMomentHeaderLabel({
          occurredOn: "2026-08-01",
          clock: "8:00 pm",
          viewerYear: new Date().getFullYear(),
        }),
      ),
    ).toBeVisible();
    expect(document.querySelectorAll(".moment-when-line")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("your time");
  });

  it("adds the poster city on one line when the viewer zone differs", () => {
    render(
      <MomentRecordedTime
        occurredOn="2026-09-24"
        clock="1:15 PM"
        occurredAt="2026-09-24T11:15:00.000Z"
        timeZone="Europe/Rome"
      />,
    );
    const text = formatRecordedMomentHeader({
      occurredOn: "2026-09-24",
      occurredAt: "2026-09-24T11:15:00.000Z",
      occurredTimezone: "Europe/Rome",
      clock: "1:15 PM",
      viewerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewerYear: new Date().getFullYear(),
    });
    expect(screen.getByText(text)).toBeVisible();
    expect(document.querySelectorAll(".moment-when-line")).toHaveLength(1);
    expect(document.body).not.toHaveTextContent("your time");
  });
});
