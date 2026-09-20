import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MomentConversationControl } from "@/features/timeline/moment-conversation-control";
import type {
  MomentConversationViewModel,
  MomentDetailViewModel,
  MomentInteractionViewModel,
} from "@/features/timeline/timeline-view-model";
import {
  documentHidesBottomNav,
  inlineNotePanelChangeEvent,
} from "./hide-bottom-nav-while-composing";
import { PrimaryNavigation } from "./primary-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/family" }));
const composerSession = vi.hoisted(() => ({
  toggleCreate: vi.fn(),
  openCreate: vi.fn(),
  isOpen: false,
  openEdit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => navigation.pathname,
}));

vi.mock("@/features/composer/composer-session", () => ({
  useComposerSession: () => composerSession,
}));

const interaction = {
  currentPerson: { name: "Brian", initial: "B", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Held close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "⌣" },
    { id: "remember-this", label: "Remember this", symbol: "✦" },
  ],
} as const satisfies MomentInteractionViewModel;

const conversation = {
  notes: [],
  reactions: [],
} as const satisfies MomentConversationViewModel;

const model = {
  id: "moment-one",
  kind: "photo",
  personName: "Molly",
  personAccent: "clay",
  displayDate: "Today",
  kicker: "Photo",
  text: "Beautiful night.",
  conversation,
} as const satisfies MomentDetailViewModel;

function renderNoteWithNav() {
  return render(
    <>
      <MomentConversationControl
        interaction={interaction}
        model={model}
        position={1}
        total={1}
      />
      <PrimaryNavigation section="timeline" />
    </>,
  );
}

function primaryNav() {
  return document.querySelector(".bottom-nav");
}

describe("documentHidesBottomNav", () => {
  it("is true only while an inline note form is in the document", () => {
    const root = document.createElement("div");
    expect(documentHidesBottomNav(root)).toBe(false);
    const form = document.createElement("form");
    form.className = "inline-note-form";
    root.append(form);
    expect(documentHidesBottomNav(root)).toBe(true);
    form.remove();
    expect(documentHidesBottomNav(root)).toBe(false);
  });
});

describe("bottom nav while composing", () => {
  beforeEach(() => {
    navigation.pathname = "/family";
    composerSession.isOpen = false;
    composerSession.toggleCreate.mockReset();
  });

  afterEach(() => {
    document.querySelector("style#our-days-dynamic-css")?.remove();
    document.documentElement.style.removeProperty("--vv-offset-top");
    document.documentElement.style.removeProperty("--vv-bottom-inset");
  });

  it("hides the bottom nav while the inline note panel is open and restores it on cancel", async () => {
    const user = userEvent.setup();
    renderNoteWithNav();

    const nav = primaryNav();
    expect(nav).not.toBeNull();
    expect(nav).not.toHaveClass("is-hidden");
    expect(nav).not.toHaveAttribute("aria-hidden");
    expect(nav).not.toHaveAttribute("inert");

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    expect(document.querySelector(".inline-note-form")).not.toBeNull();
    await waitFor(() => {
      expect(primaryNav()).toHaveClass("is-hidden");
    });
    expect(primaryNav()).toHaveAttribute("aria-hidden", "true");
    expect(primaryNav()).toHaveAttribute("inert");
    expect(
      screen.getByRole("textbox", { name: "Add a family note" }),
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector(".inline-note-form")).toBeNull();
    await waitFor(() => {
      expect(primaryNav()).not.toHaveClass("is-hidden");
    });
    expect(primaryNav()).not.toHaveAttribute("aria-hidden");
    expect(primaryNav()).not.toHaveAttribute("inert");
  });

  it("hides the bottom nav while the New Moment composer is open", () => {
    composerSession.isOpen = true;
    render(<PrimaryNavigation section="timeline" />);

    const nav = primaryNav();
    expect(nav).toHaveClass("is-hidden");
    expect(nav).toHaveAttribute("aria-hidden", "true");
    expect(nav).toHaveAttribute("inert");
  });

  it("hides the bottom nav when an inline note form appears without a React rerender from the nav", () => {
    render(<PrimaryNavigation section="timeline" />);
    expect(primaryNav()).not.toHaveClass("is-hidden");

    const form = document.createElement("form");
    form.className = "inline-note-form";
    document.body.append(form);
    act(() => {
      window.dispatchEvent(new Event(inlineNotePanelChangeEvent));
    });
    expect(primaryNav()).toHaveClass("is-hidden");

    form.remove();
    act(() => {
      window.dispatchEvent(new Event(inlineNotePanelChangeEvent));
    });
    expect(primaryNav()).not.toHaveClass("is-hidden");
  });
});
