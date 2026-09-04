import { useRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByRole("dialog")).toHaveClass("composer-type-picker");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);
    expect(
      document.querySelector(".new-moment-composer-dialog .composer-sheet"),
    ).toHaveClass("is-closing");
  });
});
