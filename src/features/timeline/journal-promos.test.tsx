import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JournalPromoBannerConfig } from "./journal-promo-config";
import { JournalPromos } from "./journal-promos";

const sharedCircle = { signedIn: true, sharedCircle: true };
const soloCircle = { signedIn: true, sharedCircle: false };

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-dismissed-promos");
  document.getElementById("journal-promo-hide")?.remove();
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "PushManager");
});

describe("JournalPromos", () => {
  it("paints the mentions card on the first render for a shared circle", () => {
    render(<JournalPromos context={sharedCircle} />);
    expect(
      screen.getByRole("heading", { name: "Tag your people" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Got it" })).toBeVisible();
    expect(screen.getByText("@")).toHaveClass("journal-banner-badge-glyph");
    expect(screen.queryByText("Phone notifications are live")).toBeNull();
  });

  it("stays dismissed across remounts and does not reveal the phone card in the same visit", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    const user = userEvent.setup();
    const { rerender, unmount } = render(
      <JournalPromos context={sharedCircle} />,
    );

    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => {
      expect(screen.queryByText("Tag your people")).toBeNull();
    });
    expect(window.localStorage.getItem("our-days:mentions-announcement")).toBe(
      "dismissed",
    );
    expect(screen.queryByText("Phone notifications are live")).toBeNull();

    rerender(<JournalPromos context={sharedCircle} />);
    expect(screen.queryByText("Tag your people")).toBeNull();

    unmount();
    render(<JournalPromos context={sharedCircle} />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    expect(
      await screen.findByText("Phone notifications are live"),
    ).toBeVisible();
  });

  it("hides mentions for a solo circle and still offers phone notifications", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY", "BpublicTestKey");
    render(<JournalPromos context={soloCircle} />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    expect(
      await screen.findByText("Phone notifications are live"),
    ).toBeVisible();
  });

  it("does not bring mentions back when another circle is opened", () => {
    window.localStorage.setItem("our-days:mentions-announcement", "dismissed");
    const { rerender } = render(<JournalPromos context={sharedCircle} />);
    expect(screen.queryByText("Tag your people")).toBeNull();
    rerender(<JournalPromos context={sharedCircle} />);
    expect(screen.queryByText("Tag your people")).toBeNull();
  });

  it("shows, orders, and dismisses a dummy config entry with no extra code", async () => {
    const user = userEvent.setup();
    const banners = [
      {
        id: "zeta",
        storageKey: "our-days:zeta-announcement",
        priority: 5,
        variant: "tip",
        title: "Zeta tip",
        body: "Zeta body",
        ctaLabel: "Okay zeta",
      },
      {
        id: "alpha",
        storageKey: "our-days:alpha-announcement",
        priority: 0,
        variant: "feature",
        title: "Alpha feature",
        body: "Alpha body",
        ctaLabel: "Okay alpha",
      },
    ] as const satisfies readonly JournalPromoBannerConfig[];
    const { unmount } = render(
      <JournalPromos
        context={{ signedIn: true, sharedCircle: false }}
        banners={banners}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Alpha feature" }),
    ).toBeVisible();
    expect(screen.queryByText("Zeta tip")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Okay alpha" }));
    await waitFor(() => {
      expect(screen.queryByText("Alpha feature")).toBeNull();
    });
    expect(window.localStorage.getItem("our-days:alpha-announcement")).toBe(
      "dismissed",
    );
    expect(screen.queryByText("Zeta tip")).toBeNull();

    unmount();
    render(
      <JournalPromos
        context={{ signedIn: true, sharedCircle: false }}
        banners={banners}
      />,
    );
    expect(screen.getByRole("heading", { name: "Zeta tip" })).toBeVisible();
  });
});
