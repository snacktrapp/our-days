import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MomentCard } from "./moment-card";
import { resetOverlayChromeForTests } from "@/features/shell/overlay-chrome";
import type { ThoughtMomentViewModel } from "./timeline-view-model";

const thought = {
  id: "thought-moment",
  journalPersonId: "person-1",
  kind: "thought",
  personName: "Molly",
  personInitial: "M",
  personAccent: "clay",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  kicker: "A thought",
  text: "Worth keeping.",
  conversation: { notes: [], reactions: [] },
} as const satisfies ThoughtMomentViewModel;

describe("timeline place meta", () => {
  afterEach(() => {
    resetOverlayChromeForTests();
    vi.unstubAllGlobals();
  });

  it("shows NOTE · pin and short name without a map mat", () => {
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          placeName: "Sand Harbor, NV, United States",
          latitude: 39.2,
          longitude: -119.93,
        }}
      />,
    );

    expect(screen.getByText("Note")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Map of Sand Harbor" }),
    ).toHaveTextContent("Sand Harbor");
    expect(screen.queryByText("NV, United States")).toBeNull();
    expect(container.querySelector(".memory-map")).toBeNull();
    expect(container.querySelector(".map-water")).toBeNull();
    expect(container.querySelector(".moment-place-pin")).not.toBeNull();
  });

  it("opens a zoomable map and dismisses it from Close", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const user = userEvent.setup();
    render(
      <MomentCard
        moment={{
          ...thought,
          placeName: "Sand Harbor",
          latitude: 39.2,
          longitude: -119.93,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Map of Sand Harbor" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Sand Harbor" });
    expect(dialog).toBeVisible();
    expect(screen.getByTitle("Map of Sand Harbor")).toHaveAttribute(
      "src",
      "/internal/map-picker",
    );
    expect(dialog.querySelector(".memory-map")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Sand Harbor" })).toBeNull(),
    );
  });

  it("does not paint a map when the style proxy is missing a key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "maptiler_key_missing",
      }),
    );
    const user = userEvent.setup();
    render(
      <MomentCard
        moment={{
          ...thought,
          kind: "photo",
          placeName: "The porch",
          latitude: 35.28,
          longitude: -120.66,
          image: {
            src: "/sample-family.jpg",
            alt: "Evening on the porch",
            badgeLabel: "AUG 28",
            width: 1200,
            height: 801,
          },
        }}
      />,
    );

    expect(screen.getByText("Photo")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Map of The porch" }));
    expect(
      await screen.findByText("Map isn’t available right now."),
    ).toBeVisible();
    expect(screen.queryByTitle("Map of The porch")).toBeNull();
  });

  it("leaves a typed place name visible without opening a map", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          placeName: "Oak Street School",
        }}
      />,
    );

    expect(screen.getByText("Oak Street School")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Map of Oak Street School/u }),
    ).toBeNull();
  });
});
