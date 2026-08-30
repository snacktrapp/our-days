// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrashPanel } from "./trash-panel";

describe("TrashPanel", () => {
  it("gives repeated restore controls distinct journal identities", () => {
    render(
      <TrashPanel
        moments={[
          {
            id: "moment-1",
            journalPersonName: "Brian",
            journalPersonAccent: "teal",
            body: "First memory",
            occurredOn: "2026-08-28",
            revision: 2,
          },
          {
            id: "moment-2",
            journalPersonName: "Molly",
            journalPersonAccent: "clay",
            body: "Second memory",
            occurredOn: "2026-08-29",
            revision: 3,
          },
        ]}
        restore={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Restore — Brian’s “First memory” moment from Aug 28, 2026 — entry 1 of 2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Restore — Molly’s “Second memory” moment from Aug 29, 2026 — entry 2 of 2",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the visible restoring state in the accessible name", async () => {
    render(
      <TrashPanel
        moments={[
          {
            id: "moment-1",
            journalPersonName: "Brian",
            journalPersonAccent: "teal",
            body: "First memory",
            occurredOn: "2026-08-28",
            revision: 2,
          },
        ]}
        restore={vi.fn(() => new Promise<never>(() => undefined))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Restore —/u }));

    expect(
      await screen.findByRole("button", { name: /^Restoring… —/u }),
    ).toBeDisabled();
  });
});
