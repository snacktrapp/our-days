import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ThoughtMomentViewModel } from "@/features/timeline/timeline-view-model";
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
    expect(document.body).toContainElement(menu);
    expect(menu).not.toHaveAttribute("style");
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

    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Moment options" })).toBeNull();
  });

  it("constrains backdating to today and confirms before discarding a draft", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<ConnectedMomentControl moment={moment} actions={actions} />);

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    await user.click(
      screen.getByRole("button", { name: "Moment date, Aug 28, 2026" }),
    );
    expect(screen.getByRole("button", { name: "Aug 30, 2026" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Aug 31, 2026" })).toBeDisabled();

    await user.clear(screen.getByLabelText("Your thought"));
    await user.type(screen.getByLabelText("Your thought"), "A changed draft.");
    await user.click(
      screen.getByRole("button", { name: "Close moment editor" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Discard your unsaved changes to this moment?",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    confirm.mockReturnValueOnce(true);
    await user.click(
      screen.getByRole("button", { name: "Close moment editor" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Moment options/u }));
    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    expect(screen.getByLabelText("Your thought")).toHaveValue("Worth keeping.");
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
    render(
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
    await user.type(screen.getByLabelText("Your thought"), " More");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Our family" })).toHaveFocus();
    expect(document.getElementById("journal-live-region")).toHaveTextContent(
      "Changes to this moment were saved.",
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(actions.update).toHaveBeenCalledWith(
      expect.objectContaining({ placeName: "Cedar Park" }),
    );
  });

  it("keeps the editor open with recovery copy after an unexpected update failure", async () => {
    const user = userEvent.setup();
    render(
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
    await user.type(screen.getByLabelText("Your thought"), " More");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That moment could not be changed. Try again.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Your thought")).toHaveValue(
      "Worth keeping. More",
    );
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
});
