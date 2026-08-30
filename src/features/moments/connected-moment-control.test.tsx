import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(
      screen.getByRole("button", {
        name: "Edit — Brian’s “Worth keeping.” moment from Aug 28, 2026 — entry 1 of 2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Edit — Molly’s “Worth keeping.” moment from Aug 29, 2026 — entry 2 of 2",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Move to trash — Molly’s “Worth keeping.” moment from Aug 29, 2026 — entry 2 of 2",
      }),
    ).toBeInTheDocument();
  });

  it("constrains backdating to today and confirms before discarding a draft", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    render(<ConnectedMomentControl moment={moment} actions={actions} />);

    await user.click(screen.getByRole("button", { name: /^Edit/u }));
    const date = screen.getByLabelText("Moment date");
    expect(date).toHaveAttribute("max", "2026-08-30");

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
    const edit = screen.getByRole("button", { name: /^Edit/u });
    await user.click(edit);
    await user.type(screen.getByLabelText("Your thought"), " More");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Our family" })).toHaveFocus();
    expect(document.getElementById("journal-live-region")).toHaveTextContent(
      "Changes to this moment were saved.",
    );
    expect(navigation.replace).toHaveBeenCalledWith("/family");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
