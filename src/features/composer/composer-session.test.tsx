import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  currentPickerTimeValue,
  formatPickerTimeLabel,
} from "./date-time-fields";
import {
  ComposerSessionProvider,
  useComposerSession,
} from "./composer-session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/family",
}));

const model = {
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

function AddMoment() {
  const session = useComposerSession();
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!session) return null;
  return (
    <button
      ref={triggerRef}
      className="header-add-moment"
      type="button"
      aria-label="Add moment"
      aria-expanded={session.isOpen}
      onClick={() => session.toggleCreate(triggerRef.current)}
    >
      Add moment
    </button>
  );
}

describe("ComposerSessionProvider", () => {
  it("toggles the type picker closed from a second + tap", async () => {
    const user = userEvent.setup();
    render(
      <ComposerSessionProvider model={model}>
        <AddMoment />
      </ComposerSessionProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Add moment" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "New moment" });
    expect(dialog).toHaveClass("composer-dialog");
    expect(dialog).toHaveClass("composer-type-picker");
    expect(dialog.querySelector(".activity-sheet")).toHaveClass(
      "composer-sheet",
    );
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Drafts/u })).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(
      document.querySelector(".new-moment-composer-dialog .composer-sheet"),
    ).toHaveClass("is-closing");
  });

  it("defaults create Post to Just me when Home is on YOU", async () => {
    const user = userEvent.setup();
    render(
      <ComposerSessionProvider
        model={{
          ...model,
          experience: "connected-family",
          photoPostingEnabled: true,
          circleId: "family",
          postableCircles: [
            { id: "family", name: "Trapp Family", personId: "person" },
          ],
        }}
        homeContext={{ kind: "you" }}
      >
        <AddMoment />
      </ComposerSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add moment" }));
    await user.click(screen.getByRole("button", { name: /Written entry/ }));
    expect(screen.getByRole("checkbox", { name: "Just me" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Trapp Family" }),
    ).not.toBeChecked();
  });

  it("opens a create Photo draft with the current local time", async () => {
    const user = userEvent.setup();
    render(
      <ComposerSessionProvider
        model={{
          ...model,
          experience: "connected-family",
          photoPostingEnabled: true,
          circleId: "20000000-0000-4000-8000-000000000001",
        }}
      >
        <AddMoment />
      </ComposerSessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Add moment" }));
    await user.click(screen.getByRole("button", { name: /^Photo/u }));
    expect(
      screen.getByRole("button", {
        name: `Time, ${formatPickerTimeLabel(currentPickerTimeValue())}`,
      }),
    ).toBeVisible();
  });
});
