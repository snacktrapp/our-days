import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhotoCardPager } from "./photo-card-pager";
import type { PhotoMomentViewModel } from "./timeline-view-model";
import { PrivatePhotoImage } from "@/components/private-photo-image";

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
    .forEach((img) => {
      markImgReady(img);
      fireEvent.load(img);
    });
  document
    .querySelectorAll<HTMLImageElement>(".photo-card-pager img")
    .forEach((img) => markImgReady(img));
}

function swipeAlbum(
  target: Element,
  {
    fromX = 180,
    toX = 120,
    y = 80,
    pointerId = 2,
  }: {
    fromX?: number;
    toX?: number;
    y?: number;
    pointerId?: number;
  } = {},
) {
  fireEvent.pointerDown(target, {
    pointerId,
    pointerType: "touch",
    clientX: fromX,
    clientY: y,
  });
  fireEvent.pointerMove(target, {
    pointerId,
    pointerType: "touch",
    clientX: toX,
    clientY: y + 4,
  });
  fireEvent.pointerUp(target, {
    pointerId,
    pointerType: "touch",
    clientX: toX,
    clientY: y + 4,
  });
}

function incomingImg() {
  return document.querySelector(
    '[data-photo-index="1"] img',
  ) as HTMLImageElement | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PhotoCardPager", () => {
  it("starts the whole nearby album before the cover finishes and never refetches on return", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const fetchMock = vi.fn(
      (src: string) => new Promise((resolve) => pending.set(src, resolve)),
    );
    vi.stubGlobal("fetch", fetchMock);
    let blobs = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:photo-${++blobs}`,
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const moment = porchAlbum(6);
    render(
      <PhotoCardPager
        moment={moment}
        images={moment.photos!.map((photo, i) => (
          <PrivatePhotoImage
            key={photo.id}
            src={`/api/photo/${i}`}
            alt={photo.alt}
            highPriority={i === 0}
          />
        ))}
      />,
    );
    const resolvePhoto = async (i: number, ok = true) => {
      const settle = pending.get(`/api/photo/${i}`);
      if (settle) {
        await act(async () =>
          settle({
            ok,
            blob: async () => new Blob(["photo"]),
          }),
        );
      }
      if (ok) {
        const img = document.querySelector(
          `[data-photo-index="${i}"] img`,
        ) as HTMLImageElement;
        markImgReady(img);
        fireEvent.load(img);
      }
    };
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(new Set(fetchMock.mock.calls.map(([src]) => src))).toEqual(
      new Set(Array.from({ length: 5 }, (_, i) => `/api/photo/${i + 1}`)),
    );
    expect(
      document.querySelector('[data-photo-index="0"] img'),
    ).toHaveAttribute("src", "/api/photo/0");
    await resolvePhoto(0);
    const original = document.querySelector('[data-photo-index="0"] img');

    const pager = document.querySelector(".photo-card-pager")!;
    swipeAlbum(pager);
    expect(track()).toHaveAttribute("data-phase", "idle");
    expect(screen.getByRole("img", { name: "Porch 1" })).toBeVisible();
    await resolvePhoto(1);
    await waitFor(() => expect(track()).toHaveClass("is-sliding"));
    settleSlide();
    expect(fetchMock).toHaveBeenCalledTimes(5);

    swipeAlbum(pager, { fromX: 120, toX: 180 });
    settleSlide();
    expect(screen.getByRole("img", { name: "Porch 1" })).toBe(original);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(revoke).not.toHaveBeenCalled();

    // Wrapping to a failed neighbor exposes its retry control rather than
    // trapping the carousel indefinitely on the outgoing photo.
    swipeAlbum(pager, { fromX: 120, toX: 180 });
    await resolvePhoto(5, false);
    await waitFor(() => expect(track()).toHaveClass("is-sliding"));
    settleSlide();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByText("Photo 6 of 6")).toBeInTheDocument();
  });

  it("leaves a single photo without arrows or a slide track", () => {
    renderPager({
      ...album,
      photos: [album.photos[0]],
    });

    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Next photo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous photo" }),
    ).not.toBeInTheDocument();
    expect(track()).toBeNull();
  });

  it("does not mount a distant album until it approaches the viewport, then retains its images", () => {
    let notify: IntersectionObserverCallback;
    const disconnect = vi.fn();
    const options = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: IntersectionObserverCallback,
          init: IntersectionObserverInit,
        ) {
          notify = callback;
          options(init);
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    renderPager(porchAlbum(4));

    expect(screen.getByRole("img", { name: "Porch 1" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Porch 2" })).toBeNull();
    expect(document.querySelectorAll(".photo-card-pager img")).toHaveLength(1);
    expect(
      [...document.querySelectorAll("[data-photo-index]")].map((node) =>
        node.getAttribute("data-photo-index"),
      ),
    ).toEqual(["0", "1", "2", "3"]);
    expect(
      document.querySelectorAll(".photo-card-pager-frame.is-parked"),
    ).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Next photo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous photo" }),
    ).not.toBeInTheDocument();

    expect(options).toHaveBeenCalledWith({ rootMargin: "800px 0px" });
    act(() =>
      notify(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(document.querySelectorAll(".photo-card-pager img")).toHaveLength(1);
    act(() =>
      notify(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(document.querySelectorAll(".photo-card-pager img")).toHaveLength(4);
    expect(disconnect).toHaveBeenCalled();
    markPagerImagesReady();
    const firstImage = document.querySelector('[data-photo-index="0"] img');
    const pager = document.querySelector(".photo-card-pager")!;
    swipeAlbum(pager);
    settleSlide();
    markPagerImagesReady();
    swipeAlbum(pager, { pointerId: 3 });
    settleSlide();

    expect(screen.getByRole("img", { name: "Porch 3" })).toBeVisible();
    expect(
      [...document.querySelectorAll("[data-photo-index]")].map((node) =>
        node.getAttribute("data-photo-index"),
      ),
    ).toEqual(["2", "0", "1", "3"]);
    expect(document.querySelector('[data-photo-index="0"] img')).toBe(
      firstImage,
    );
  });

  it("keeps the outgoing photo painted until the neighbor is ready, then slides", () => {
    renderPager();
    markPagerImagesReady();
    const neighbor = incomingImg()!;
    markImgReady(document.querySelector('[data-photo-index="0"] img')!);
    markImgNotReady(neighbor);

    const pager = document.querySelector(".photo-card-pager")!;
    swipeAlbum(pager);

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
      swipeAlbum(document.querySelector(".photo-card-pager")!);

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

    swipeAlbum(document.querySelector(".photo-card-pager")!, {
      fromX: 180,
      toX: 240,
    });
    expect(track()).toHaveAttribute("data-direction", "prev");
    expect(screen.getByRole("img", { name: "First porch" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    settleSlide();

    expect(screen.getByRole("img", { name: "Second porch" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "First porch" })).toBeNull();
  });

  it("keeps album photos out of fullscreen buttons", () => {
    renderPager();
    expect(screen.queryByRole("button")).toBeNull();

    markPagerImagesReady();
    swipeAlbum(document.querySelector(".photo-card-pager")!);
    expect(track()).toHaveClass("is-sliding");
    expect(screen.queryByRole("button")).toBeNull();
  });

  function mockCardSlideWidth(width: number) {
    const previous = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        if (this.classList?.contains("photo-card-pager-stage")) return width;
        return 0;
      },
    });
    return () => {
      if (previous) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", previous);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    };
  }

  it("locks each album slide to the stage width", () => {
    const restoreWidth = mockCardSlideWidth(390);
    try {
      renderPager(porchAlbum(4));
      const node = stage();
      expect(node?.style.getPropertyValue("--photo-card-slide-width")).toBe("");
      expect(node?.clientWidth).toBe(390);
      expect(
        document.querySelectorAll(".photo-card-pager-frame.is-outgoing"),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll(".photo-card-pager-frame.is-parked"),
      ).toHaveLength(3);
    } finally {
      restoreWidth();
    }
  });

  it("follows a horizontal drag live, then snaps past the threshold", () => {
    const restoreWidth = mockCardSlideWidth(390);
    try {
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
      expect((track() as HTMLElement).style.transform).toBe(
        "translateX(-60px)",
      );

      fireEvent.pointerUp(pager, {
        pointerId: 2,
        pointerType: "touch",
        clientX: 120,
        clientY: 84,
      });
      expect(track()).toHaveAttribute("data-direction", "next");
      expect(track()).toHaveClass("is-sliding");
      expect((track() as HTMLElement).style.transform).toBe(
        "translateX(-390px)",
      );
    } finally {
      restoreWidth();
    }
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
    swipeAlbum(document.querySelector(".photo-card-pager")!);

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
