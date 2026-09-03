import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimelineHeaderComposer } from "./timeline-header-composer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/family",
}));

const composer = {
  previewToday: "2026-09-01",
  defaultJournalPersonId: "person",
  recorderPersonId: "person",
  recordedByName: "Person",
  journalPeople: [
    {
      id: "person",
      name: "Person",
      initial: "P",
      accent: "teal",
      contextLabel: "You",
    },
  ],
  taggablePeople: [],
} as const;

describe("TimelineHeaderComposer", () => {
  it("opens entry choices from the compact header control", async () => {
    const user = userEvent.setup();
    render(<TimelineHeaderComposer composer={composer} />);

    const trigger = screen.getByRole("button", { name: "Add moment" });
    expect(trigger).toHaveClass("header-add-moment");

    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Photo or video/u }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Written entry/u }),
    ).toBeVisible();
  });
});
