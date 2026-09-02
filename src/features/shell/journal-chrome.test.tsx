import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalChromeViewModel, JournalSection } from "./shell-view-model";
import { JournalChrome } from "./journal-chrome";

vi.mock("./timeline-header-composer", () => ({
  TimelineHeaderComposer: () => <button type="button">Add moment</button>,
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
});
