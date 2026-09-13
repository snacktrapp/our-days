import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatBibleVerseMoment,
  selectBiblePassage,
} from "@/features/composer/bible-verse-catalog";
import { resetIndependentOverlayObjectUrlCache } from "@/components/independent-overlay-photo";
import { MomentCard } from "./moment-card";
import { timelineCardOccurredLabel } from "./timeline-view-model";
import { PhotoLightboxRoot, resetPhotoLightboxSession } from "./photo-lightbox";
import { thoughtCopyOverflows } from "./thought-copy-overflow";
import type {
  InsightMomentViewModel,
  MomentInteractionViewModel,
  ThoughtMomentViewModel,
} from "./timeline-view-model";

vi.mock("./thought-copy-overflow", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./thought-copy-overflow")>();
  return {
    ...actual,
    thoughtCopyOverflows: vi.fn(actual.thoughtCopyOverflows),
  };
});

const interaction = {
  currentPerson: { name: "Brian", initial: "B", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Held close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "⌣" },
    { id: "remember-this", label: "Remember this", symbol: "✦" },
  ],
} as const satisfies MomentInteractionViewModel;

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

function conversationActions() {
  return {
    load: vi.fn().mockResolvedValue({
      ok: true,
      conversation: { notes: [], reactions: [] },
    }),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    trashNote: vi.fn(),
    setReaction: vi.fn().mockResolvedValue({ ok: true, message: "Saved" }),
  };
}

function doubleTap(target: Element) {
  fireEvent.click(target, { detail: 1 });
  fireEvent.click(target, { detail: 2 });
}

describe("MomentCard double-tap heart", () => {
  it("hearts another family member's note with the existing heart reaction", async () => {
    const actions = conversationActions();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={thought}
      />,
    );

    doubleTap(screen.getByText(/Worth keeping/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "thought-moment",
        reactionId: "held-close",
      }),
    );
  });

  it("hearts a Bible verse on double-tap of the verse text", async () => {
    const actions = conversationActions();
    const passage = await selectBiblePassage("Isaiah", 40, 28, 28);
    expect(passage).not.toBeNull();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={{
          ...thought,
          id: "verse-moment",
          text: formatBibleVerseMoment(passage!.reference, passage!.text),
        }}
      />,
    );

    doubleTap(screen.getByText(/everlasting God/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "verse-moment",
        reactionId: "held-close",
      }),
    );
  });
});

describe("MomentCard long thought copy", () => {
  it("leaves a short note unclamped", () => {
    render(<MomentCard moment={thought} />);

    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Worth keeping/u).closest("blockquote"),
    ).not.toHaveClass("thought-copy-clamped");
    expect(
      screen.getByText(/Worth keeping/u).closest("blockquote"),
    ).not.toHaveAttribute("aria-expanded");
  });

  it("shows five lines then See more on a long note, and See less after expand", async () => {
    vi.mocked(thoughtCopyOverflows).mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MomentCard
        moment={{
          ...thought,
          text: "Tonight the kitchen was loud enough to fill the whole screen.",
        }}
      />,
    );

    const quote = screen.getByText(/kitchen was loud/u).closest("blockquote");
    expect(quote).toHaveClass("thought-copy-clamped");
    expect(quote).not.toHaveAttribute("aria-expanded");
    const more = screen.getByRole("button", { name: "See more" });
    expect(more).toHaveClass("thought-more");
    expect(more).toHaveAttribute("aria-expanded", "false");

    await user.click(more);
    expect(quote).not.toHaveClass("thought-copy-clamped");
    expect(quote).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "See less" }));
    expect(quote).toHaveClass("thought-copy-clamped");
    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();
    vi.mocked(thoughtCopyOverflows).mockReset();
  });

  it("expands and collapses when tapping overflowing body text", async () => {
    vi.mocked(thoughtCopyOverflows).mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MomentCard
        moment={{
          ...thought,
          text: "Tonight the kitchen was loud enough to fill the whole screen.",
        }}
      />,
    );

    const quote = screen.getByText(/kitchen was loud/u).closest("blockquote");
    expect(quote).toHaveClass("thought-copy-clamped");
    expect(quote).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();

    await user.click(quote!);
    await waitFor(() => {
      expect(quote).not.toHaveClass("thought-copy-clamped");
    });
    expect(quote).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(quote!);
    await waitFor(() => {
      expect(quote).toHaveClass("thought-copy-clamped");
    });
    expect(quote).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();
    vi.mocked(thoughtCopyOverflows).mockReset();
  });

  it("keeps double-tap heart on a clamped Bible verse", async () => {
    vi.mocked(thoughtCopyOverflows).mockReturnValue(true);
    const actions = conversationActions();
    const passage = await selectBiblePassage("Leviticus", 12, 1, 8);
    expect(passage).not.toBeNull();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={{
          ...thought,
          id: "long-verse-moment",
          text: formatBibleVerseMoment(passage!.reference, passage!.text),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();
    doubleTap(screen.getByText(/Leviticus/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "long-verse-moment",
        reactionId: "held-close",
      }),
    );
    vi.mocked(thoughtCopyOverflows).mockReset();
  });
});

describe("MomentCard timeline media", () => {
  afterEach(() => {
    resetPhotoLightboxSession();
    resetIndependentOverlayObjectUrlCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps a landscape photo at its native frame instead of a cropped box", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          id: "landscape-photo",
          kind: "photo",
          kicker: "A photo",
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

    const image = screen.getByRole("img", { name: "Evening on the porch" });
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "801");
    const frame = image.closest(".photo-frame");
    expect(frame).toHaveClass("has-known-ratio", "has-reserved-frame");
    const sizer = frame?.querySelector(".photo-frame-sizer");
    expect(sizer).toHaveAttribute("viewBox", "0 0 1200 801");
    expect(frame?.firstElementChild).toBe(sizer);
  });

  it("reserves the photo frame above conversation chrome before pixels arrive", () => {
    const { container } = render(
      <MomentCard
        interaction={interaction}
        conversationActions={conversationActions()}
        moment={{
          ...thought,
          id: "pending-photo",
          kind: "photo",
          kicker: "A photo",
          conversation: {
            notes: [
              {
                id: "note-1",
                authorName: "Molly",
                authorInitial: "M",
                authorAccent: "clay",
                body: "The quiet ride home.",
                displayDate: "Aug 29, 2026",
              },
            ],
            reactions: [
              {
                id: "reaction-1",
                personName: "Molly",
                personInitial: "M",
                personAccent: "clay",
                reactionId: "held-close",
              },
            ],
          },
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

    const card = container.querySelector(".photo-card");
    const frame = card?.querySelector(".photo-frame");
    const copy = card?.querySelector(".card-copy");
    const conversation = card?.querySelector(".inline-conversation");
    expect(frame).toHaveClass("has-reserved-frame");
    expect(frame?.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 1200 801",
    );
    expect(copy?.contains(conversation ?? null)).toBe(true);
    expect(frame?.compareDocumentPosition(copy!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("Molly");
    expect(
      screen.getByRole("list", { name: "Notes from family" }),
    ).toHaveTextContent("The quiet ride home.");
  });

  it("pages a multi-photo card without opening the lightbox", async () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          id: "album-photo",
          kind: "photo",
          kicker: "A photo",
          image: {
            src: "/sample-family.jpg",
            alt: "First porch",
            badgeLabel: "AUG 28",
            width: 1200,
            height: 801,
          },
          photos: [
            {
              id: "p1",
              src: "/sample-family.jpg",
              alt: "First porch",
              width: 1200,
              height: 801,
            },
            {
              id: "p2",
              src: "/sample-family.jpg",
              alt: "Second porch",
              width: 900,
              height: 1200,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Second porch" })).toBeNull();
    document
      .querySelectorAll<HTMLImageElement>(".photo-card-pager img")
      .forEach((img) => {
        Object.defineProperty(img, "complete", {
          configurable: true,
          get: () => true,
        });
        Object.defineProperty(img, "naturalWidth", {
          configurable: true,
          get: () => 800,
        });
      });
    const pager = document.querySelector(".photo-card-pager")!;
    fireEvent.pointerDown(pager, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 180,
      clientY: 80,
    });
    fireEvent.pointerMove(pager, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 120,
      clientY: 84,
    });
    fireEvent.pointerUp(pager, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 120,
      clientY: 84,
    });
    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    const track = document.querySelector(".photo-card-pager-track");
    expect(track).toHaveAttribute("data-direction", "next");
    expect(track).toHaveClass("is-paired");
    fireEvent.transitionEnd(track!, { propertyName: "transform" });
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("presents a video moment as a poster card and starts play on one tap", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    const poster =
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIhwgMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD//2Q==";
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          id: "kitchen-video",
          kind: "video",
          kicker: "A video",
          video: {
            src: "/api/media/videos/kitchen-video",
            poster,
            width: 160,
            height: 90,
          },
        }}
      />,
    );

    expect(container.querySelector(".video-card-poster")).toHaveAttribute(
      "src",
      poster,
    );
    expect(container.querySelector(".video-viewer-trigger video")).toBeNull();
    expect(container.querySelector(".video-card")).not.toBeNull();
    expect(container.querySelector(".video-frame")).toHaveClass(
      "has-known-ratio",
      "has-reserved-frame",
    );
    expect(container.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 160 90",
    );
    expect(container.querySelector(".video-viewer-play")).toHaveTextContent(
      "▶",
    );
    expect(screen.getByText("Video")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Video in Molly’s journal from Aug 28, 2026",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Full-screen video: Video in Molly’s journal from Aug 28, 2026",
    });
    const lightboxVideo = dialog.querySelector("video");
    expect(lightboxVideo).toHaveAttribute("controls");
    expect(lightboxVideo).toHaveAttribute("playsinline");
    expect(lightboxVideo).toHaveAttribute("autoplay");
    expect(lightboxVideo).toHaveAttribute("poster", poster);
    expect(play).toHaveBeenCalled();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done.closest(".media-viewer-chrome")).not.toBeNull();
    expect(
      dialog
        .querySelector(".media-viewer-chrome")
        ?.compareDocumentPosition(dialog.querySelector(".media-viewer-video")!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a play badge on a dark mat when no poster is ready yet", () => {
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          id: "pending-poster-video",
          kind: "video",
          kicker: "A video",
          video: {
            src: "/api/media/videos/pending-poster-video",
            width: 160,
            height: 90,
          },
        }}
      />,
    );

    expect(container.querySelector(".video-card-mat")).not.toBeNull();
    expect(container.querySelector(".video-card-mat-label")).toHaveTextContent(
      "Video",
    );
    expect(container.querySelector(".video-viewer-trigger video")).toBeNull();
    expect(container.querySelector(".video-viewer-play")).toHaveTextContent(
      "▶",
    );
    expect(container.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 160 90",
    );
  });

  it("reserves a 16:9 mat for posterless videos with unknown dimensions", () => {
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          id: "la-marina-style-video",
          kind: "video",
          kicker: "A video",
          video: {
            src: "/api/media/videos/la-marina-style-video",
            mimeType: "video/quicktime",
          },
        }}
      />,
    );

    const frame = container.querySelector(".photo-frame.video-frame");
    expect(frame?.className).toContain("has-reserved-frame");
    expect(frame?.className).toContain("has-default-video-ratio");
    expect(container.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 16 9",
    );
    expect(container.querySelector(".video-card-mat")).not.toBeNull();
    expect(container.querySelector(".video-card-mat-label")).toHaveTextContent(
      "iPhone video",
    );
    expect(container.querySelector(".video-viewer-play")).toHaveTextContent(
      "▶",
    );
  });

  it("sizes a portrait video to a tall native frame instead of a 4:3 mat", () => {
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          id: "portrait-video",
          kind: "video",
          kicker: "A video",
          video: {
            src: "/api/media/videos/portrait-video",
            width: 1080,
            height: 1920,
          },
        }}
      />,
    );

    expect(container.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 1080 1920",
    );
    expect(container.querySelector(".video-frame")).toHaveClass(
      "has-known-ratio",
    );
  });

  it("reserves a 16:9 frame instead of collapsing when clip size is unknown", () => {
    const { container } = render(
      <MomentCard
        moment={{
          ...thought,
          id: "unknown-ratio-video",
          kind: "video",
          kicker: "A video",
          video: {
            src: "/api/media/videos/unknown-ratio-video",
          },
        }}
      />,
    );

    expect(container.querySelector(".photo-frame-sizer")).toHaveAttribute(
      "viewBox",
      "0 0 16 9",
    );
    expect(container.querySelector(".video-frame")).toHaveClass(
      "has-reserved-frame",
      "has-default-video-ratio",
    );
    expect(container.querySelector(".video-frame")).not.toHaveClass(
      "has-known-ratio",
    );
  });

  it("keeps a portrait photo at its native 9:16 frame", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          id: "portrait-photo",
          kind: "photo",
          kicker: "A photo",
          image: {
            src: "/sample-family.jpg",
            alt: "Standing in the doorway",
            badgeLabel: "AUG 28",
            width: 1080,
            height: 1920,
          },
        }}
      />,
    );

    const image = screen.getByRole("img", {
      name: "Standing in the doorway",
    });
    expect(image).toHaveAttribute("width", "1080");
    expect(image).toHaveAttribute("height", "1920");
  });

  it("leaves both card images in place when opening A then B then A", async () => {
    const firstSrc = "/private-photo-a.jpg";
    const lastSrc = "/private-photo-b.jpg";
    let created = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:card-overlay-${++created}`,
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(["overlay-bytes"], { type: "image/gif" }),
      })),
    );

    render(
      <PhotoLightboxRoot>
        <MomentCard
          moment={{
            ...thought,
            id: "photo-a",
            kind: "photo",
            kicker: "A photo",
            image: {
              src: firstSrc,
              alt: "First light",
              badgeLabel: "AUG 28",
              delivery: "private",
              width: 80,
              height: 50,
            },
          }}
        />
        <MomentCard
          moment={{
            ...thought,
            id: "photo-b",
            kind: "photo",
            kicker: "A photo",
            image: {
              src: lastSrc,
              alt: "Last light",
              badgeLabel: "AUG 28",
              delivery: "private",
              width: 80,
              height: 50,
            },
          }}
        />
      </PhotoLightboxRoot>,
    );

    const first = screen.getByRole("img", { name: "First light" });
    const last = screen.getByRole("img", { name: "Last light" });
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
    );
    expect(first).toHaveAttribute("src", firstSrc);
    expect(last).toHaveAttribute("src", lastSrc);
    expect(
      screen.getByRole("dialog").querySelector(`img[src="${firstSrc}"]`),
    ).toBeNull();
    expect(screen.getByRole("dialog").querySelector("img")?.src).toMatch(
      /^blob:/u,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: Last light",
      }),
    );
    expect(screen.getByRole("img", { name: "First light" })).toBe(first);
    expect(last).toHaveAttribute("src", lastSrc);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
    );
    expect(screen.getByRole("img", { name: "Last light" })).toBe(last);
    expect(first).toBeVisible();
    expect(last).toBeVisible();
    expect(first).toHaveAttribute("src", firstSrc);
    expect(last).toHaveAttribute("src", lastSrc);
    expect(window.getComputedStyle(first).visibility).not.toBe("hidden");
    expect(window.getComputedStyle(last).visibility).not.toBe("hidden");
    expect(document.documentElement).not.toHaveClass("media-viewer-open");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

const insight = {
  id: "insight-moment",
  journalPersonId: "",
  kind: "insight",
  personName: "TARS",
  personInitial: "T",
  personAccent: "slate",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  kicker: "An insight",
  text: "Morning sunlight is the most powerful stimulus for setting your circadian rhythm.",
  attribution: "Huberman Lab — Master Your Sleep",
  sourceUrl: "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
  sourceLabel: "Listen",
  conversation: { notes: [], reactions: [] },
} as const satisfies InsightMomentViewModel;

describe("MomentCard date line", () => {
  it("leaves the card body date-only; the rail formats date · time", () => {
    render(<MomentCard moment={thought} />);

    expect(screen.queryByText(/·/u)).not.toBeInTheDocument();
    expect(timelineCardOccurredLabel(thought.occurredOn, "7:25 PM")).toBe(
      "Aug. 28, 2026 · 7:25 PM",
    );
    expect(timelineCardOccurredLabel(thought.occurredOn)).toBe("Aug. 28, 2026");
  });
});

describe("MomentCard insight treatment", () => {
  it("renders quote, attribution, and source without a person byline", () => {
    const { container } = render(<MomentCard moment={insight} />);

    expect(screen.getByText("Insight")).toBeVisible();
    expect(
      screen.getByText(/Morning sunlight is the most powerful stimulus/u),
    ).toBeVisible();
    expect(screen.getByText(/Huberman Lab — Master Your Sleep/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "Listen" })).toHaveAttribute(
      "href",
      insight.sourceUrl,
    );
    expect(container.querySelector(".avatar-node")).toBeNull();
    expect(screen.queryByText("TARS")).toBeNull();
  });
});

describe("MomentCard audience chip", () => {
  it("expands circle names and does not offer Edit even when setAudience exists", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          audience: "family",
          showAudienceChip: true,
          audienceChipLabel: "Our Days +1",
          audienceCircleNames: ["Our Days", "Cousins"],
          canChange: true,
          revision: 1,
        }}
        connectedActions={{
          update: vi.fn(),
          trash: vi.fn(),
          setAudience: vi.fn(),
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Audience, Our Days +1" }),
    );
    expect(screen.getByText("Our Days")).toBeVisible();
    expect(screen.getByText("Cousins")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Posted to" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Moment options/u }));
    expect(screen.getByRole("button", { name: /^Edit —/u })).toHaveTextContent(
      "Edit moment",
    );
  });

  it("does not offer Edit from another person's audience chip", () => {
    render(
      <MomentCard
        moment={{
          ...thought,
          audience: "family",
          showAudienceChip: true,
          audienceChipLabel: "Our Days",
          audienceCircleNames: ["Our Days"],
          canChange: false,
        }}
        connectedActions={{
          update: vi.fn(),
          trash: vi.fn(),
          setAudience: vi.fn(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Audience, Our Days" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("Our Days");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Moment options/u }),
    ).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Posted to" })).toBeNull();
  });
});
