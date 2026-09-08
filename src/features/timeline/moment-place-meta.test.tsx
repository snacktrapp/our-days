import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  });

  it("shows NOTE · pin and short name linking to system Maps", () => {
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
    const placeLink = screen.getByRole("link", {
      name: "Open Sand Harbor in Maps",
    });
    expect(placeLink).toHaveTextContent("Sand Harbor");
    expect(placeLink).toHaveAttribute(
      "href",
      "https://maps.apple.com/?ll=39.2,-119.93&q=Sand%20Harbor",
    );
    expect(placeLink).toHaveAttribute("target", "_blank");
    expect(screen.queryByText("NV, United States")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.querySelector(".memory-map")).toBeNull();
    expect(container.querySelector(".map-water")).toBeNull();
    expect(container.querySelector(".moment-place-pin")).not.toBeNull();
  });

  it("does not open an in-app map sheet", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          placeName: "Bass Lake",
          latitude: 37.3247,
          longitude: -119.5664,
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open Bass Lake in Maps" }),
    ).toHaveAttribute(
      "href",
      "https://maps.apple.com/?ll=37.3247,-119.5664&q=Bass%20Lake",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTitle("Map of Bass Lake")).toBeNull();
    expect(screen.queryByRole("button", { name: /Map of/u })).toBeNull();
  });

  it("leaves a typed place name visible without a Maps link", () => {
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
      screen.queryByRole("link", { name: /Open Oak Street School in Maps/u }),
    ).toBeNull();
  });
});
