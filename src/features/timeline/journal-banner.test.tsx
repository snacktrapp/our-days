import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JournalBanner } from "./journal-banner";

describe("JournalBanner", () => {
  it("renders enablement variant with journal-banner chrome", async () => {
    render(
      <JournalBanner
        variant="enablement"
        title="Phone notifications are live"
        body="Get a quiet ping on this phone."
        cta={{
          kind: "pill",
          label: "Turn on notifications",
          href: "/settings/family#notifications",
        }}
        showNotNow
        onDismiss={vi.fn()}
      />,
    );

    const banner = await screen.findByRole("status");
    expect(banner).toHaveClass("journal-banner");
    expect(banner).toHaveAttribute("data-variant", "enablement");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Phone notifications are live",
    );
    expect(
      screen.getByRole("link", { name: "Turn on notifications" }),
    ).toHaveClass("journal-banner-cta-pill");
  });

  it("renders tip variant with quiet CTA", async () => {
    render(
      <JournalBanner
        variant="tip"
        title="Tip: add a caption"
        body="A line of text helps grandparents follow along."
        cta={{
          kind: "quiet",
          label: "Add a caption",
          href: "/compose",
        }}
        onDismiss={vi.fn()}
      />,
    );

    const banner = await screen.findByRole("status");
    expect(banner).toHaveAttribute("data-variant", "tip");
    expect(screen.getByRole("link", { name: "Add a caption" })).toHaveClass(
      "journal-banner-cta-quiet",
    );
    expect(banner.querySelector(".journal-banner-badge svg")).not.toHaveClass(
      "journal-banner-sparkle",
    );
  });

  it("renders a configured glyph in the badge and keeps the bell for enablement", async () => {
    const { unmount } = render(
      <JournalBanner
        variant="feature"
        icon="@"
        title="Tag your people"
        body="Mention someone."
        cta={{ kind: "pill", label: "Got it", onClick: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );

    expect(await screen.findByText("@")).toHaveClass(
      "journal-banner-badge-glyph",
    );

    unmount();
    render(
      <JournalBanner
        variant="enablement"
        title="Phone notifications are live"
        body="Get a quiet ping on this phone."
        cta={{
          kind: "pill",
          label: "Turn on notifications",
          href: "/settings/family#notifications",
        }}
        onDismiss={vi.fn()}
      />,
    );

    const badge = screen
      .getByRole("status")
      .querySelector(".journal-banner-badge");
    expect(badge?.querySelector(".journal-banner-badge-glyph")).toBeNull();
    expect(badge?.querySelector("svg.journal-banner-sparkle")).toBeNull();
    expect(badge?.querySelectorAll("path").length).toBeGreaterThan(1);
  });

  it("collapses a feature pill before telling the parent it was dismissed", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <JournalBanner
        promoId="mentions"
        variant="feature"
        title="Tag your people"
        body="Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it."
        cta={{ kind: "pill", label: "Got it", onClick: vi.fn() }}
        onDismiss={onDismiss}
      />,
    );

    const banner = await screen.findByRole("status");
    expect(banner).toHaveAttribute("data-variant", "feature");
    expect(banner).toHaveAttribute("data-promo", "mentions");
    expect(screen.getByRole("button", { name: "Got it" })).toHaveClass(
      "journal-banner-cta-pill-feature",
    );
    expect(banner.querySelector(".journal-banner-badge-glyph")).toBeNull();
    const sparkle = banner.querySelector(".journal-banner-sparkle");
    expect(sparkle?.querySelectorAll("path")).toHaveLength(1);
    expect(sparkle?.innerHTML ?? "").not.toContain("M12 3v2.2");

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(banner).toHaveAttribute("data-motion", "fade");
    expect(onDismiss).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });
});
