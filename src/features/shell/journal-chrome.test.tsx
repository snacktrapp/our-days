import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  JournalChromeViewModel,
  JournalSection,
} from "./shell-view-model";
import { JournalChrome } from "./journal-chrome";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./timeline-header-composer", () => ({
  TimelineHeaderComposer: () => <button type="button">Add moment</button>,
}));
vi.mock("@/features/composer/composer-session", () => ({
  ComposerSessionProvider: ({
    children,
  }: {
    children: import("react").ReactNode;
  }) => children,
  useComposerSession: () => null,
}));
vi.mock("./notification-center", () => ({
  NotificationCenter: () => <button type="button">Open notifications</button>,
}));
vi.mock("./theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Use light appearance</button>,
}));
vi.mock("./primary-navigation", () => ({
  PrimaryNavigation: () => (
    <nav className="bottom-nav" aria-label="Primary navigation" />
  ),
}));
vi.mock("@/features/composer/photo-status-shelf", () => ({
  PhotoStatusShelf: () => (
    <section className="photo-status-shelf" aria-label="Private photo status" />
  ),
}));

afterEach(cleanup);

const model = {
  accent: "teal",
  eyebrow: "Our family",
  title: "Account",
  composer: { photoPostingEnabled: false },
  familyMark: [],
} as unknown as JournalChromeViewModel;

describe("JournalChrome", () => {
  it.each(["group", "person"] as const)(
    "shows a named %s feed with Back to Circles instead of the main selector",
    (kind) => {
      render(
        <JournalChrome
          model={{ ...model, title: "Named feed" }}
          section="timeline"
          switcher={[
            { kind, label: "Named feed", current: true, href: "/people/other" },
          ]}
        >
          <p>Entries</p>
        </JournalChrome>,
      );
      expect(screen.getByRole("heading", { name: "Named feed" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Choose a journal" }),
      ).toBeNull();
      expect(
        screen.getByRole("link", { name: "← Back to Circles" }),
      ).toHaveAttribute("href", "/circles");
    },
  );

  it("keeps your own journal a named drill-in when opened from Circles", () => {
    render(
      <JournalChrome
        model={{ ...model, title: "Brian" }}
        section="timeline"
        backToCirclesHref="/circles#circle-family"
        switcher={[
          { kind: "you", label: "Brian", current: true, href: "/people/brian" },
        ]}
      >
        <p>Entries</p>
      </JournalChrome>,
    );
    expect(screen.getByRole("heading", { name: "Brian" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Choose a journal" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: "← Back to Circles" }),
    ).toHaveAttribute("href", "/circles#circle-family");
  });
  it.each<JournalSection>(["timeline", "people", "memories", "settings"])(
    "uses the identical primary header controls for %s",
    (section) => {
      render(
        <JournalChrome model={model} section={section}>
          <p>Page content</p>
        </JournalChrome>,
      );

      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
        "href",
        "/settings/family",
      );
      expect(screen.queryByRole("button", { name: "Add moment" })).toBeNull();
      expect(
        screen.getByRole("button", { name: "Open notifications" }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Use light appearance" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("link", { name: /Back to/u }),
      ).not.toBeInTheDocument();
    },
  );

  it("can stream Activity without waiting for notification items on the chrome model", () => {
    render(
      <JournalChrome
        model={model}
        section="timeline"
        activity={<button type="button">Deferred activity</button>}
      >
        <p>Page content</p>
      </JournalChrome>,
    );

    expect(
      screen.getByRole("button", { name: "Deferred activity" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Open notifications" }),
    ).toBeNull();
  });

  it("keeps the upload chip outside the scrolling journal stage", () => {
    const { container } = render(
      <JournalChrome
        model={
          {
            ...model,
            composer: { ...model.composer, circleId: "circle-1" },
          } as JournalChromeViewModel
        }
        section="timeline"
      >
        <p>Page content</p>
      </JournalChrome>,
    );
    const stage = container.querySelector(".phone-stage");
    const chip = container.querySelector(".photo-status-shelf");
    expect(chip).not.toBeNull();
    expect(stage?.contains(chip)).toBe(false);
  });

  it("keeps the floating top pill outside the scrolling journal stage", () => {
    const { container } = render(
      <JournalChrome model={model} section="timeline">
        <p>Page content</p>
      </JournalChrome>,
    );
    const stage = container.querySelector(".phone-stage");
    const header = container.querySelector(".topbar");
    expect(header).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(stage?.contains(header)).toBe(false);
    expect(container.querySelector(".app-shell")?.contains(header)).toBe(false);
  });

  it("keeps the floating bottom pill outside the scrolling journal stage", () => {
    const { container } = render(
      <JournalChrome model={model} section="timeline">
        <p>Page content</p>
      </JournalChrome>,
    );
    const stage = container.querySelector(".phone-stage");
    const header = container.querySelector(".topbar");
    const nav = container.querySelector(".bottom-nav");
    expect(nav).not.toBeNull();
    expect(stage?.contains(nav)).toBe(false);
    expect(container.querySelector(".app-shell")?.contains(nav)).toBe(false);
    expect(header?.parentElement).toBe(nav?.parentElement);
  });

  it("opens the family switcher from the middle title", () => {
    const { container } = render(
      <JournalChrome
        model={{ ...model, title: "All circles" }}
        section="timeline"
        switcher={[
          {
            kind: "all",
            label: "All circles",
            href: "/family",
            current: true,
          },
          {
            kind: "person",
            label: "Molly",
            href: "/people/molly",
            current: false,
          },
        ]}
      >
        <p>Moments</p>
      </JournalChrome>,
    );

    const switcher = container.querySelector(".title-switcher");
    expect(switcher).not.toHaveClass("is-open");

    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));

    expect(switcher).toHaveClass("is-open");
    expect(
      screen.getByRole("navigation", { name: "Choose a family timeline" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "All circles" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: "Molly" })).toBeNull();

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Choose a journal" }),
      {
        key: "Escape",
      },
    );
    expect(document.querySelector(".title-switcher-sheet")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Choose a family timeline" }),
    ).toBeNull();
  });

  it("keeps Account and other static titles from becoming a family switcher", () => {
    const { container } = render(
      <JournalChrome model={model} section="settings">
        <p>Account</p>
      </JournalChrome>,
    );

    expect(container.querySelector(".title-switcher")).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Choose a family timeline" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeVisible();
    expect(
      container.querySelector(".title-lockup .title-switcher-heading h1"),
    ).toHaveTextContent("Account");
    expect(container.querySelector(".title-switcher-heading svg")).toBeNull();
  });

  it("keeps the All-circles header when a refresh chrome is degraded", () => {
    const { rerender } = render(
      <JournalChrome
        model={{ ...model, title: "All circles", eyebrow: "Circles" }}
        section="timeline"
      >
        <p>Moments</p>
      </JournalChrome>,
    );
    expect(screen.getByRole("heading", { name: "All circles" })).toBeVisible();

    rerender(
      <JournalChrome
        model={{ ...model, title: "Our Days", eyebrow: "Our family" }}
        section="timeline"
        preserveChrome
      >
        <p>Moments</p>
      </JournalChrome>,
    );

    expect(screen.getByRole("heading", { name: "All circles" })).toBeVisible();
    expect(screen.queryByText("Something interrupted the story")).toBeNull();
  });

  it("replaces page content with a destination skeleton as soon as a journal is chosen", () => {
    render(
      <JournalChrome
        model={{ ...model, title: "All circles" }}
        section="timeline"
        switcher={[
          {
            kind: "all",
            label: "All circles",
            href: "/family",
            current: true,
          },
          {
            kind: "you",
            label: "Brian",
            href: "/people/brian",
            current: false,
          },
        ]}
      >
        <p>Moments</p>
      </JournalChrome>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose a journal" }));
    fireEvent.click(screen.getByRole("link", { name: "Just me" }));

    expect(screen.queryByText("Moments")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Opening this journal" }),
    ).toHaveClass("route-pending-skeleton");
    expect(screen.getByRole("heading", { name: "Just me" })).toBeVisible();
    expect(document.querySelector(".title-switcher")).not.toHaveClass(
      "is-open",
    );
    expect(document.querySelector(".timeline-empty-state")).toBeNull();
  });
});
