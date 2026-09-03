import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  LocationMomentViewModel,
  PhotoMomentViewModel,
  ThoughtMomentViewModel,
} from "@/features/timeline/timeline-view-model";
import { ComposerSessionProvider } from "@/features/composer/composer-session";
import {
  formatBibleVerseMoment,
  selectBiblePassage,
} from "@/features/composer/bible-verse-catalog";
import { ConnectedMomentControl } from "./connected-moment-control";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => navigation,
}));

const moment = {
  id: "moment-1",
  journalPersonId: "person-1",
  kind: "thought",
  personName: "Brian",
  personInitial: "B",
  personAccent: "teal",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  maxOccurredOn: "2026-08-30",
  kicker: "A thought",
  text: "Worth keeping.",
  placeName: "Cedar Park",
  conversation: { notes: [], reactions: [] },
  canChange: true,
  revision: 1,
  editOccurrence: { occurredAt: null, timeZone: null },
} as const satisfies ThoughtMomentViewModel;

const actions = {
  update: vi.fn(),
  trash: vi.fn(),
};

const composerModel = {
  previewToday: "2026-08-30",
  defaultJournalPersonId: "person-1",
  recorderPersonId: "person-1",
  recordedByName: "Brian",
  experience: "connected-family" as const,
  circleId: "20000000-0000-4000-8000-000000000001",
  photoPostingEnabled: true,
  journalPeople: [
    {
      id: "person-1",
      name: "Brian",
      initial: "B",
      accent: "teal" as const,
      contextLabel: "You",
    },
  ],
  taggablePeople: [
    {
      id: "molly",
      name: "Molly",
      initial: "M",
      accent: "clay" as const,
      contextLabel: "Co-organizer",
    },
  ],
};

function renderWithComposer(ui: ReactNode) {
  return render(
    <ComposerSessionProvider model={composerModel}>
      {ui}
    </ComposerSessionProvider>,
  );
}

describe("ConnectedMomentControl", () => {
  it("does not show an options control on entries the viewer cannot change", () => {
    render(
      <ConnectedMomentControl
        moment={{ ...moment, canChange: false, revision: undefined }}
        actions={actions}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^Moment options/u }),
    ).toBeNull();
  });

  it("names repeated actions with their person and date", () => {
    render(
      <>
        <ConnectedMomentControl
          moment={moment}
          actions={actions}
          position={1}
          total={2}
        />
        <ConnectedMomentControl
          moment={{
            ...moment,
            id: "moment-2",
            personName: "Molly",
            displayDate: "Aug 29, 2026",
          }}
          actions={actions}
          position={2}
          total={2}
        />
      </>,
    );

    const optionButtons = screen.getAllByRole("button", {
      name: /^Moment options/u,
    });
    expect(optionButtons[0]).toHaveAccessibleName(
      "Moment options — Brian’s “Worth keeping.” moment from Aug 28, 2026 — entry 1 of 2",
    );
    expect(optionButtons[1]).toHaveAccessibleName(
      "Moment options — Molly’s “Worth keeping.” moment from Aug 29, 2026 — entry 2 of 2",
    );
    fireEvent.click(optionButtons[1]);
    const trashButton = screen.getByRole("button", {
      name: "Move to trash — Molly’s “Worth keeping.” moment from Aug 29, 2026 — entry 2 of 2",
    });
    expect(trashButton).toBeInTheDocument();
    const menu = screen.getByRole("group", { name: "Moment options" });
    expect(menu.tagName).toBe("DIV");
    expect(optionButtons[1].parentElement).toContainElement(menu);
    expect(menu).toHaveClass("overlay-popover");
    expect(menu).not.toHaveClass("connected-moment-menu-portal");
    expect(menu).toHaveAttribute("data-placement", "below");
    expect(menu).not.toHaveAttribute("style");
    expect(menu).toHaveTextContent("Copy text");
    expect(menu).toHaveTextContent("Edit moment");
    expect(menu).toHaveTextContent("Move to trash");
  });

  it("closes the compact options menu from its trigger or an outside press", async () => {
    const user = userEvent.setup();
    render(<ConnectedMomentControl moment={moment} actions={actions} />);

    const trigger = screen.getByRole("button", { name: /^Moment options/u });
    await user.click(trigger);
    expect(
      screen.getByRole("group", { name: "Moment options" }),
    ).toBeInTheDocument();

    await user.click(trigger);
    expect(screen.queryByRole("group", { name: "Moment options" })).toBeNull();
    expect(document.querySelector(".connected-moment-menu")).toHaveClass(
      "is-closing",
    );

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Moment options" })).toBeNull();
  });

  it("closes the compact options menu instantly when motion is reduced", async () => {
    const media = vi.mocked(window.matchMedia);
    media.mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const user = userEvent.setup();
      render(<ConnectedMomentControl moment={moment} actions={actions} />);
      const trigger = screen.getByRole("button", { name: /^Moment options/u });
      await user.click(trigger);
      expect(screen.getByRole("group", { name: "Moment options" })).toHaveClass(
        "overlay-popover",
      );
      await user.click(trigger);
      expect(
        screen.queryByRole("group", { name: "Moment options" }),
      ).toBeNull();
      expect(document.querySelector(".connected-moment-menu")).toBeNull();
    } finally {
      media.mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }
  });

  it("flips the compact options menu above the trigger when the nav would cover it", async () => {
    const nav = document.createElement("nav");
    nav.className = "bottom-nav";
    document.body.append(nav);
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 400,
      top: 400,
      right: 320,
      bottom: 456,
      left: 0,
      width: 320,
      height: 56,
      toJSON: () => ({}),
    });
    const user = userEvent.setup();
    render(<ConnectedMomentControl moment={moment} actions={actions} />);

    const trigger = screen.getByRole("button", { name: /^Moment options/u });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 260,
      y: 360,
      top: 360,
      right: 304,
      bottom: 404,
      left: 260,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    });
    await user.click(trigger);

    expect(
      screen.getByRole("group", { name: "Moment options" }),
    ).toHaveAttribute("data-placement", "above");
    nav.remove();
  });

  it("constrains backdating to today and confirms before discarding a draft", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    renderWithComposer(
      <ConnectedMomentControl moment={moment} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    expect(
      screen.getByRole("heading", { name: "New written entry" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Moment date, Aug 28, 2026" }),
    );
    expect(screen.getByRole("button", { name: "Aug 30, 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Aug 31, 2026" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Entry"));
    await user.type(screen.getByLabelText("Entry"), "A changed draft.");
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Discard your unsaved changes to this moment?",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    confirm.mockReturnValueOnce(true);
    await user.click(
      screen.getByRole("button", { name: "Close moment composer" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    expect(screen.getByLabelText("Entry")).toHaveValue("Worth keeping.");
    confirm.mockRestore();
  });

  it("keeps the visible moving state in the accessible name", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    render(
      <ConnectedMomentControl
        moment={moment}
        actions={{
          update: vi.fn(),
          trash: vi.fn(() => new Promise<never>(() => undefined)),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Moment options/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Move to trash/u }));

    expect(
      await screen.findByRole("button", { name: /^Moving… —/u }),
    ).toBeDisabled();
    confirm.mockRestore();
  });

  it("focuses stable journal context after a save", async () => {
    const user = userEvent.setup();
    actions.update.mockResolvedValueOnce({ ok: true, message: "Saved" });
    renderWithComposer(
      <>
        <p id="journal-live-region" aria-live="assertive" />
        <h1 id="journal-focus-target" tabIndex={-1}>
          Our family
        </h1>
        <ConnectedMomentControl moment={moment} actions={actions} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    await user.type(screen.getByLabelText("Entry"), " More");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Our family" })).toHaveFocus();
    expect(document.getElementById("journal-live-region")).toHaveTextContent(
      "Changes to this moment were saved.",
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(actions.update).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "",
        body: "Worth keeping. More",
        placeName: "Cedar Park",
      }),
    );
  });

  it("keeps the editor open with recovery copy after an unexpected update failure", async () => {
    const user = userEvent.setup();
    renderWithComposer(
      <ConnectedMomentControl
        moment={moment}
        actions={{
          update: vi.fn().mockRejectedValue(new Error("network failed")),
          trash: vi.fn(),
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    await user.type(screen.getByLabelText("Entry"), " More");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That moment could not be changed. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Entry")).toHaveValue("Worth keeping. More");
  });

  it("shows recovery copy after an unexpected trash failure", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(
      <ConnectedMomentControl
        moment={moment}
        actions={{
          update: vi.fn(),
          trash: vi.fn().mockRejectedValue(new Error("network failed")),
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Move to trash/u }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That moment could not be moved to trash. Try again.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Move to trash/u }),
      ).toBeEnabled(),
    );
    confirm.mockRestore();
  });

  it("opens a Bible verse in the add-entry pickers instead of Edit this moment", async () => {
    const user = userEvent.setup();
    const passage = await selectBiblePassage("Isaiah", 40, 28, 28);
    expect(passage).not.toBeNull();
    renderWithComposer(
      <ConnectedMomentControl
        moment={{
          ...moment,
          text: formatBibleVerseMoment(passage!.reference, passage!.text),
          taggedPeople: [{ id: "molly", name: "Molly" }],
        }}
        actions={actions}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));

    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Your thought")).toBeNull();
    expect(screen.queryByLabelText("Entry")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Add a Bible verse" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Book, Isaiah/u }),
    ).toBeVisible();
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Verse text") as HTMLTextAreaElement).value,
      ).toContain("everlasting God");
    });
  });

  it("opens a note in the written-entry composer instead of Edit this moment", async () => {
    const user = userEvent.setup();
    renderWithComposer(
      <ConnectedMomentControl moment={moment} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));

    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "New written entry" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Entry")).toHaveValue("Worth keeping.");
    expect(
      screen.getByRole("button", { name: /^Place, Cedar Park/u }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Choose another/u }),
    ).toBeNull();
  });

  it("opens a location in the add-entry place composer", async () => {
    const user = userEvent.setup();
    const locationMoment = {
      ...moment,
      kind: "location",
      place: "Cedar Park",
      mapLabel: "Remembered here",
      text: "The wind made everyone laugh.",
    } as const satisfies LocationMomentViewModel;
    renderWithComposer(
      <ConnectedMomentControl moment={locationMoment} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));

    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "New location entry" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Place, Cedar Park/u }),
    ).toBeVisible();
    expect(screen.getByLabelText("Details")).toHaveValue(
      "The wind made everyone laugh.",
    );
    expect(screen.queryByLabelText("Your thought")).toBeNull();
  });

  it("opens a photo in the add-entry photo composer without a new file picker", async () => {
    const user = userEvent.setup();
    const photoMoment = {
      ...moment,
      kind: "photo",
      text: "At the lake",
      image: {
        src: "/api/media/moments/moment-1",
        alt: "Photo in Brian’s journal from Aug 28, 2026",
        badgeLabel: "Aug 28, 2026",
        delivery: "private",
      },
    } as const satisfies PhotoMomentViewModel;
    renderWithComposer(
      <ConnectedMomentControl moment={photoMoment} actions={actions} />,
    );

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));

    expect(
      screen.queryByRole("heading", { name: "Edit this moment" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "New photo entry" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Note")).toHaveValue("At the lake");
    expect(
      screen.getByRole("img", {
        name: "Photo in Brian’s journal from Aug 28, 2026",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Choose photo or video")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });
});
