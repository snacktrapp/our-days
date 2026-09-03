import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  JournalChromeViewModel,
  JournalSection,
} from "./shell-view-model";
import { JournalChrome } from "./journal-chrome";

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
  PrimaryNavigation: () => <nav aria-label="Primary navigation" />,
}));
vi.mock("@/features/composer/photo-status-shelf", () => ({
  PhotoStatusShelf: () => null,
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
  it.each<JournalSection>(["timeline", "people", "memories", "settings"])(
    "uses the identical primary header controls for %s",
    (section) => {
      render(
        <JournalChrome model={model} section={section}>
          <p>Page content</p>
        </JournalChrome>,
      );

      expect(screen.getByRole("button", { name: "Add moment" })).toBeVisible();
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

  it("opens the family switcher from the middle title", () => {
    const { container } = render(
      <JournalChrome
        model={{ ...model, title: "All our days" }}
        section="timeline"
        switcher={[
          { label: "Family", href: "/family", current: true },
          { label: "Molly", href: "/people/molly", current: false },
        ]}
      >
        <p>Moments</p>
      </JournalChrome>,
    );

    const switcher = container.querySelector(".title-switcher");
    expect(switcher).not.toHaveAttribute("open");

    fireEvent.click(
      screen.getByRole("heading", { name: "All our days" }).closest("summary")!,
    );

    expect(switcher).toHaveAttribute("open");
    expect(
      screen.getByRole("navigation", { name: "Choose a family timeline" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Family" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Molly" })).toHaveAttribute(
      "href",
      "/people/molly",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".title-switcher nav")).toHaveClass(
      "is-closing",
    );
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
  });
});
