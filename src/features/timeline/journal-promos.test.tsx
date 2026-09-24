import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JournalPromos } from "./journal-promos";

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-mentions-announcement");
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
});

describe("JournalPromos", () => {
  it("paints the mentions card on the first render for a shared circle", () => {
    render(<JournalPromos mentionsEligible />);
    expect(
      screen.getByRole("heading", { name: "Tag your people" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Got it" })).toBeVisible();
    expect(screen.queryByText("Phone notifications are live")).toBeNull();
  });

  it("stays dismissed across remounts and does not reveal the phone card in the same visit", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const user = userEvent.setup();
    const { rerender, unmount } = render(<JournalPromos mentionsEligible />);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => {
      expect(screen.queryByText("Tag your people")).toBeNull();
    });
    expect(window.localStorage.getItem("our-days:mentions-announcement")).toBe(
      "dismissed",
    );
    expect(screen.queryByText("Phone notifications are live")).toBeNull();

    rerender(<JournalPromos mentionsEligible />);
    expect(screen.queryByText("Tag your people")).toBeNull();

    unmount();
    render(<JournalPromos mentionsEligible />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    expect(
      await screen.findByText("Phone notifications are live"),
    ).toBeVisible();
  });

  it("hides mentions for a solo circle and still offers phone notifications", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    render(<JournalPromos mentionsEligible={false} />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    expect(
      await screen.findByText("Phone notifications are live"),
    ).toBeVisible();
  });

  it("does not bring mentions back when another circle is opened", () => {
    window.localStorage.setItem("our-days:mentions-announcement", "dismissed");
    const { rerender } = render(<JournalPromos mentionsEligible />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    rerender(<JournalPromos mentionsEligible />);
    expect(screen.queryByText("Tag your people")).toBeNull();
  });
});
