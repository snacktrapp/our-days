import { render, screen } from "@testing-library/react";
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
  });
});
