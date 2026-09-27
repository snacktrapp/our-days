// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { openingTimelinePhotoSrc } from "@/features/moments/moment-photos";
import { MomentCard } from "./moment-card";
import type {
  MomentInteractionViewModel,
  PhotoMomentViewModel,
} from "./timeline-view-model";

const interaction = {
  currentPerson: { name: "Brian", initial: "B", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Held close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "⌣" },
    { id: "remember-this", label: "Remember this", symbol: "✦" },
  ],
} as const satisfies MomentInteractionViewModel;

const momentId = "10000000-0000-4000-8000-000000000099";
const firstPhotoId = "10000000-0000-4000-8000-000000000011";
const secondPhotoId = "10000000-0000-4000-8000-000000000012";

const moment = {
  id: momentId,
  journalPersonId: "brian",
  kind: "photo",
  personName: "Molly",
  personInitial: "M",
  personAccent: "clay",
  displayDate: "Aug 1, 2026",
  occurredOn: "2026-08-01",
  kicker: "A photo",
  text: "The lake.",
  conversation: { notes: [], reactions: [] },
  image: {
    src: `/api/media/moments/${momentId}?photo=${firstPhotoId}`,
    alt: "Photo in Molly’s journal from Aug 1, 2026",
    badgeLabel: "Aug 1, 2026",
    delivery: "private",
    width: 1200,
    height: 800,
  },
  photos: [
    {
      id: firstPhotoId,
      src: `/api/media/moments/${momentId}?photo=${firstPhotoId}`,
      alt: "Photo in Molly’s journal from Aug 1, 2026",
      width: 1200,
      height: 800,
    },
    {
      id: secondPhotoId,
      src: `/api/media/moments/${momentId}?photo=${secondPhotoId}`,
      alt: "Second photo",
      width: 800,
      height: 600,
    },
  ],
} as const satisfies PhotoMomentViewModel;

describe("first photo preload", () => {
  it("preloads the same card URL the cover image requests", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const src = openingTimelinePhotoSrc([
      { moment_id: momentId, moment_kind: "photo" },
    ]);
    render(
      <MomentCard
        interaction={interaction}
        moment={moment}
        preload
        conversationActions={{
          load: vi.fn().mockResolvedValue({
            ok: true,
            conversation: { notes: [], reactions: [] },
          }),
          createNote: vi.fn(),
          updateNote: vi.fn(),
          trashNote: vi.fn(),
          setReaction: vi.fn(),
          setNoteHeart: vi.fn(),
        }}
      />,
    );

    const cover = screen.getByRole("img", {
      name: "Photo in Molly’s journal from Aug 1, 2026",
    });
    expect(src).toBe(`/api/media/moments/${momentId}?w=1080`);
    expect(cover).toHaveAttribute("src", src);
    expect(cover).toHaveAttribute("fetchpriority", "high");
    expect(document.querySelector('link[rel="preload"]')).toHaveAttribute(
      "href",
      src,
    );
    expect(document.querySelectorAll('link[rel="preload"]')).toHaveLength(1);
  });
});
