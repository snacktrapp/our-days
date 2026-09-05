import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhotoCardPager } from "./photo-card-pager";
import type { PhotoMomentViewModel } from "./timeline-view-model";

const album = {
  id: "album-photo",
  journalPersonId: "person-1",
  kind: "photo",
  personName: "Molly",
  personInitial: "M",
  personAccent: "clay",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  kicker: "A photo",
  text: "Porch light.",
  conversation: { notes: [], reactions: [] },
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
} as const satisfies PhotoMomentViewModel;

function albumImages() {
  return album.photos.map((photo) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={photo.id}
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
    />
  ));
}

function renderPager(moment: PhotoMomentViewModel = album) {
  return render(<PhotoCardPager moment={moment} images={albumImages()} />);
}

function track() {
  return document.querySelector(".photo-card-pager-track");
}

function settleSlide() {
  const node = track();
  if (node) fireEvent.transitionEnd(node, { propertyName: "transform" });
}

describe("PhotoCardPager", () => {
  it("leaves a single photo without arrows or a slide track", () => {
    renderPager({
      ...album,
      photos: [album.photos[0]],
    });

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Next photo" }),
    ).not.toBeInTheDocument();
    expect(track()).toBeNull();
  });

  it("slides the current photo out only after the neighbor is on the track", () => {
    renderPager();

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Second porch" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(track()).toHaveAttribute("data-direction", "next");
    expect(track()).toHaveClass("is-paired");
    expect(track()).toHaveClass("is-sliding");

    settleSlide();

    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open photo full screen: Second porch",
      }),
    ).toBeInTheDocument();
  });

  it("slides the previous photo in from the left and wraps the album", () => {
    renderPager();

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(track()).toHaveAttribute("data-direction", "prev");
    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    settleSlide();

    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
  });

  it("pages on a horizontal swipe without treating a vertical drag as a swipe", () => {
    const { container } = renderPager();
    const pager = container.querySelector(".photo-card-pager")!;

    fireEvent.pointerDown(pager, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 180,
      clientY: 80,
    });
    fireEvent.pointerMove(pager, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 176,
      clientY: 160,
    });
    fireEvent.pointerUp(pager, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 176,
      clientY: 160,
    });
    expect(screen.queryByRole("img", { name: "Second porch" })).toBeNull();

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
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(track()).toHaveAttribute("data-direction", "next");
  });

  it("swaps instantly when motion is reduced", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderPager();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));

    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
    expect(track()).not.toHaveClass("is-paired");
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });
});
