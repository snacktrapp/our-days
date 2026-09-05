import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function albumImages(moment: PhotoMomentViewModel = album) {
  return (moment.photos ?? [moment.image]).map((photo) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={"id" in photo ? photo.id : photo.alt}
      src={photo.src}
      alt={photo.alt}
      width={photo.width}
      height={photo.height}
    />
  ));
}

function renderPager(moment: PhotoMomentViewModel = album) {
  return render(
    <PhotoCardPager moment={moment} images={albumImages(moment)} />,
  );
}

function porchAlbum(count: number): PhotoMomentViewModel {
  return {
    ...album,
    photos: Array.from({ length: count }, (_, index) => ({
      id: `p${index + 1}`,
      src: "/sample-family.jpg",
      alt: `Porch ${index + 1}`,
      width: 1200,
      height: 801,
    })),
  };
}

function track() {
  return document.querySelector(".photo-card-pager-track");
}

function stage() {
  return document.querySelector(
    ".photo-card-pager-stage",
  ) as HTMLElement | null;
}

function settleSlide() {
  const node = track();
  if (node) fireEvent.transitionEnd(node, { propertyName: "transform" });
}

function markImgReady(
  img: HTMLImageElement,
  naturalWidth = 1200,
  naturalHeight = 801,
) {
  Object.defineProperty(img, "complete", {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(img, "naturalWidth", {
    configurable: true,
    get: () => naturalWidth,
  });
  Object.defineProperty(img, "naturalHeight", {
    configurable: true,
    get: () => naturalHeight,
  });
}

function markImgNotReady(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", {
    configurable: true,
    get: () => false,
  });
  Object.defineProperty(img, "naturalWidth", {
    configurable: true,
    get: () => 0,
  });
}

function markPagerImagesReady() {
  document
    .querySelectorAll<HTMLImageElement>(".photo-card-pager img")
    .forEach((img) => markImgReady(img));
}

function incomingImg() {
  return document.querySelector(
    '[data-photo-index="1"] img',
  ) as HTMLImageElement | null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("mounts every album frame when a multi-photo card is first painted", () => {
    renderPager(porchAlbum(4));

    expect(screen.getByRole("img", { name: "Porch 1" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Porch 2" })).toBeNull();
    expect(
      [...document.querySelectorAll("[data-photo-index]")].map((node) =>
        node.getAttribute("data-photo-index"),
      ),
    ).toEqual(["0", "1", "2", "3"]);
    expect(
      document.querySelectorAll(".photo-card-pager-frame.is-parked"),
    ).toHaveLength(3);

    markPagerImagesReady();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    settleSlide();
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    settleSlide();

    expect(screen.getByRole("img", { name: "Porch 3" })).toBeVisible();
    expect(
      [...document.querySelectorAll("[data-photo-index]")].map((node) =>
        node.getAttribute("data-photo-index"),
      ),
    ).toEqual(["2", "0", "1", "3"]);
  });

  it("keeps the outgoing photo painted until the neighbor is ready, then slides", () => {
    renderPager();
    const neighbor = incomingImg()!;
    markImgReady(document.querySelector('[data-photo-index="0"] img')!);
    markImgNotReady(neighbor);

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Second porch" })).toBeNull();
    expect(track()).toHaveAttribute("data-phase", "idle");
    expect(track()).not.toHaveClass("is-sliding");

    markImgReady(neighbor, 900, 1200);
    fireEvent.load(neighbor);

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

  it("slides a ready neighbor immediately and settles height to the incoming photo", () => {
    const clientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    const offsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList?.contains("photo-card-pager-stage") ? 400 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if (this.classList?.contains("is-incoming")) return 480;
        if (this.classList?.contains("photo-card-pager-stage")) {
          return this.style.height ? parseFloat(this.style.height) : 267;
        }
        if (this.classList?.contains("photo-card-pager-frame")) return 267;
        return 0;
      },
    });

    try {
      renderPager();
      markPagerImagesReady();
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));

      expect(track()).toHaveClass("is-sliding");
      expect(stage()?.style.height).not.toBe("");
      expect(Number.parseFloat(stage()?.style.height ?? "0")).toBeGreaterThan(
        0,
      );

      settleSlide();

      expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
      expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
      expect(stage()?.style.height).toBe("480px");
    } finally {
      if (clientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          clientWidth,
        );
      }
      if (offsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          offsetHeight,
        );
      }
    }
  });

  it("slides the previous photo in from the left and wraps the album", () => {
    renderPager();
    markPagerImagesReady();

    fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
    expect(track()).toHaveAttribute("data-direction", "prev");
    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    settleSlide();

    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
  });

  it("follows a horizontal drag live, then snaps past the threshold", () => {
    const { container } = renderPager();
    markPagerImagesReady();
    const pager = container.querySelector(".photo-card-pager")!;

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

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(track()).toHaveAttribute("data-phase", "drag");
    expect(track()).toHaveAttribute("data-dx", "-60");
    expect((track() as HTMLElement).style.transform).toContain("-60px");

    fireEvent.pointerUp(pager, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 120,
      clientY: 84,
    });
    expect(track()).toHaveAttribute("data-direction", "next");
    expect(track()).toHaveClass("is-sliding");
  });

  it("springs back when a horizontal drag is released before the threshold", () => {
    const { container } = renderPager();
    markPagerImagesReady();
    const pager = container.querySelector(".photo-card-pager")!;

    fireEvent.pointerDown(pager, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 180,
      clientY: 80,
    });
    fireEvent.pointerMove(pager, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 155,
      clientY: 82,
    });
    expect(track()).toHaveAttribute("data-phase", "drag");
    expect(track()).toHaveAttribute("data-dx", "-25");

    fireEvent.pointerUp(pager, {
      pointerId: 3,
      pointerType: "touch",
      clientX: 155,
      clientY: 82,
    });
    expect(track()).toHaveClass("is-springing");
    settleSlide();
    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Second porch" })).toBeNull();
    expect(track()).toHaveAttribute("data-phase", "idle");
  });

  it("pages on a horizontal swipe without treating a vertical drag as a swipe", () => {
    const { container } = renderPager();
    markPagerImagesReady();
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
    expect(track()).toHaveAttribute("data-phase", "idle");

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
    markPagerImagesReady();
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
