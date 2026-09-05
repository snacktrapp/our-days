import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetOverlayChromeForTests } from "@/features/shell/overlay-chrome";
import { resetIndependentOverlayObjectUrlCache } from "@/components/independent-overlay-photo";
import {
  PhotoLightboxRoot,
  PhotoLightboxTrigger,
  resetPhotoLightboxSession,
} from "./photo-lightbox";

function mockRect(node: Element, rect: Partial<DOMRect>) {
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
    x: rect.x ?? 0,
    y: rect.y ?? 0,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => ({}),
  });
}

const cardPixelA =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const cardPixelB =
  "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAEAAAICRAEAOw==";

function cardPhoto(src: string, alt: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={80} height={50} />
  );
}

function mockIndependentOverlayDecode() {
  let created = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:overlay-${++created}`,
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["overlay-bytes"], { type: "image/gif" }),
    })),
  );
}

function renderPhotos() {
  return render(
    <PhotoLightboxRoot>
      <div className="timeline">
        <div className="photo-frame">
          <PhotoLightboxTrigger
            src={cardPixelA}
            alt="First light"
            width={80}
            height={50}
          >
            {cardPhoto(cardPixelA, "First light card")}
          </PhotoLightboxTrigger>
        </div>
        <div className="photo-frame">
          <PhotoLightboxTrigger
            src={cardPixelB}
            alt="Last light"
            width={80}
            height={50}
          >
            {cardPhoto(cardPixelB, "Last light card")}
          </PhotoLightboxTrigger>
        </div>
      </div>
    </PhotoLightboxRoot>,
  );
}

describe("photo lightbox", () => {
  beforeEach(() => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#0b1712");
    document.head.append(meta);
  });

  afterEach(() => {
    resetPhotoLightboxSession();
    resetIndependentOverlayObjectUrlCache();
    resetOverlayChromeForTests();
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.remove();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fades a portaled overlay without remounting the card img", async () => {
    mockIndependentOverlayDecode();
    renderPhotos();
    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: First light",
    });
    const card = screen.getByRole("img", { name: "First light card" });
    mockRect(trigger, { left: 24, top: 180, width: 342, height: 220 });
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    fireEvent.click(trigger);

    const overlay = await screen.findByRole("img", { name: "First light" });
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-motion",
      "opening",
    );
    fireEvent.load(overlay);
    const stage = document.querySelector(
      ".photo-lightbox-stage",
    ) as HTMLElement;
    expect(overlay).toHaveClass("photo-lightbox-photo");
    expect(overlay.style.left).toBe("");
    expect(overlay.style.top).toBe("");
    expect(overlay.style.width).toBe("");
    expect(overlay.style.height).toBe("");
    expect(overlay).toBeVisible();
    expect(overlay.style.opacity).toBe("");
    expect(overlay.style.transform).toBe("");
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("data-motion", "open"),
    );
    expect(stage).toBeTruthy();
    expect(stage.contains(overlay)).toBe(true);
    expect(screen.getByRole("dialog")).toHaveClass("photo-lightbox");
    expect(screen.getByRole("dialog").closest(".timeline")).toBeNull();
    expect(screen.getByRole("dialog").closest(".photo-frame")).toBeNull();
    expect(document.body.contains(screen.getByRole("dialog"))).toBe(true);
    expect(document.body).not.toHaveClass("media-viewer-scroll-locked");
    expect(document.documentElement).not.toHaveClass("media-viewer-open");
    expect(document.documentElement).toHaveClass("overlay-open");
    expect(document.body).toHaveClass("overlay-open");
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#000000");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(card);
    expect(card).toHaveAttribute("src", cardPixelA);
    expect(card).toBeVisible();
    expect(overlay).toHaveAttribute("src", "blob:overlay-1");
    expect(overlay).not.toBe(card);

    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-motion",
      "closing",
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.documentElement).not.toHaveClass("overlay-open");
      expect(document.body).not.toHaveClass("overlay-open");
    });
    expect(
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content"),
    ).toBe("#0b1712");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(card);
  });

  it("keeps each card photo painted when two photos are opened A then B then A", async () => {
    mockIndependentOverlayDecode();
    renderPhotos();
    const first = screen.getByRole("img", { name: "First light card" });
    const last = screen.getByRole("img", { name: "Last light card" });
    mockRect(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
      { left: 24, top: 180, width: 342, height: 220 },
    );
    mockRect(
      screen.getByRole("button", {
        name: "Open photo full screen: Last light",
      }),
      { left: 24, top: 400, width: 342, height: 220 },
    );
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
    );
    expect(
      await screen.findByRole("img", { name: "First light" }),
    ).toHaveAttribute("src", "blob:overlay-1");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: Last light",
      }),
    );
    expect(
      await screen.findByRole("img", { name: "Last light" }),
    ).toHaveAttribute("src", "blob:overlay-2");
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
    );
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(first).toHaveAttribute("src", cardPixelA);
    expect(last).toHaveAttribute("src", cardPixelB);
    expect(first).toBeVisible();
    expect(last).toBeVisible();
  });

  it("contain-fits a portrait in an explicit-height flex stage", async () => {
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Portrait"
          width={1080}
          height={1920}
        >
          {cardPhoto(cardPixelA, "Portrait card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: Portrait",
      }),
    );
    const overlay = await screen.findByRole("img", { name: "Portrait" });
    fireEvent.load(overlay);
    const stage = document.querySelector(
      ".photo-lightbox-stage",
    ) as HTMLElement;
    expect(overlay).toHaveClass("photo-lightbox-photo");
    expect(overlay.style.left).toBe("");
    expect(overlay.style.top).toBe("");
    expect(overlay).toBeVisible();
    expect(overlay.style.opacity).toBe("");
    expect(overlay.style.width).toBe("");
    expect(overlay.style.height).toBe("");
    expect(stage).toHaveClass("photo-lightbox-stage");
    expect(stage.contains(overlay)).toBe(true);
  });

  function lightboxTrack() {
    return document.querySelector(".photo-lightbox-track");
  }

  function lightboxStage() {
    return document.querySelector(".photo-lightbox-stage") as HTMLElement;
  }

  function markLightboxImagesReady() {
    document
      .querySelectorAll<HTMLImageElement>(".photo-lightbox img")
      .forEach((img) => {
        Object.defineProperty(img, "complete", {
          configurable: true,
          get: () => true,
        });
        Object.defineProperty(img, "naturalWidth", {
          configurable: true,
          get: () => 80,
        });
      });
  }

  function swipeLightbox(
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

  async function openAlbumLightbox() {
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="First light"
          photos={[
            { src: cardPixelA, alt: "First light" },
            { src: cardPixelB, alt: "Last light" },
          ]}
          index={0}
        >
          {cardPhoto(cardPixelA, "First light card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    const card = screen.getByRole("img", { name: "First light card" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open photo full screen: First light",
      }),
    );
    const first = await screen.findByRole("img", { name: "First light" });
    fireEvent.load(first);
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute("data-motion", "open"),
    );
    await waitFor(() => {
      expect(
        document.querySelectorAll(".photo-lightbox-frame img"),
      ).toHaveLength(2);
    });
    markLightboxImagesReady();
    return card;
  }

  it("swipes across an album without remounting the card image", async () => {
    const card = await openAlbumLightbox();
    expect(
      screen.queryByRole("button", { name: "Next photo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous photo" }),
    ).not.toBeInTheDocument();
    swipeLightbox(lightboxStage());
    fireEvent.transitionEnd(lightboxTrack()!, { propertyName: "transform" });
    const second = await screen.findByRole("img", { name: "Last light" });
    expect(second).toBeVisible();
    expect(screen.queryByRole("img", { name: "First light" })).toBeNull();
    expect(card).toHaveAttribute("src", cardPixelA);
    expect(card).toBeVisible();
    swipeLightbox(lightboxStage(), { fromX: 180, toX: 240, pointerId: 3 });
    fireEvent.transitionEnd(lightboxTrack()!, { propertyName: "transform" });
    expect(
      await screen.findByRole("img", { name: "First light" }),
    ).toBeVisible();
  });

  it("follows a horizontal drag live, then snaps past the threshold", async () => {
    await openAlbumLightbox();
    const stage = lightboxStage();
    fireEvent.pointerDown(stage, {
      pointerId: 4,
      pointerType: "touch",
      clientX: 180,
      clientY: 80,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 4,
      pointerType: "touch",
      clientX: 120,
      clientY: 84,
    });
    expect(screen.getByRole("img", { name: "First light" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Last light" })).toBeVisible();
    expect(lightboxTrack()).toHaveAttribute("data-phase", "drag");
    expect(lightboxTrack()).toHaveAttribute("data-dx", "-60");
    expect((lightboxTrack() as HTMLElement).style.transform).toContain("-60px");
    fireEvent.pointerUp(stage, {
      pointerId: 4,
      pointerType: "touch",
      clientX: 120,
      clientY: 84,
    });
    expect(lightboxTrack()).toHaveAttribute("data-direction", "next");
    expect(lightboxTrack()).toHaveClass("is-sliding");
  });

  it("springs back when a horizontal drag is released before the threshold", async () => {
    await openAlbumLightbox();
    const stage = lightboxStage();
    fireEvent.pointerDown(stage, {
      pointerId: 5,
      pointerType: "touch",
      clientX: 180,
      clientY: 80,
    });
    fireEvent.pointerMove(stage, {
      pointerId: 5,
      pointerType: "touch",
      clientX: 155,
      clientY: 82,
    });
    expect(lightboxTrack()).toHaveAttribute("data-phase", "drag");
    expect(lightboxTrack()).toHaveAttribute("data-dx", "-25");
    fireEvent.pointerUp(stage, {
      pointerId: 5,
      pointerType: "touch",
      clientX: 155,
      clientY: 82,
    });
    expect(lightboxTrack()).toHaveClass("is-springing");
    fireEvent.transitionEnd(lightboxTrack()!, { propertyName: "transform" });
    expect(screen.getByRole("img", { name: "First light" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Last light" })).toBeNull();
    expect(lightboxTrack()).toHaveAttribute("data-phase", "idle");
  });

  it("does not page while the photo is zoomed", async () => {
    await openAlbumLightbox();
    fireEvent.doubleClick(screen.getByRole("img", { name: "First light" }));
    expect(screen.getByRole("img", { name: "First light" })).toHaveClass(
      "is-zoomed",
    );
    swipeLightbox(lightboxStage());
    expect(screen.getByRole("img", { name: "First light" })).toBeVisible();
    expect(screen.queryByRole("img", { name: "Last light" })).toBeNull();
    expect(lightboxTrack()).toHaveAttribute("data-phase", "idle");
  });

  it("mounts album neighbors when the overlay first opens", async () => {
    await openAlbumLightbox();
    expect(
      [...document.querySelectorAll("[data-photo-index]")].map((node) =>
        node.getAttribute("data-photo-index"),
      ),
    ).toEqual(["0", "1"]);
    expect(
      document.querySelectorAll(".photo-lightbox-frame.is-parked"),
    ).toHaveLength(1);
  });

  it("does not capture pointermove, so native pinch is not blocked", async () => {
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger src={cardPixelA} alt="Porch">
          {cardPhoto(cardPixelA, "Porch card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open photo full screen: Porch" }),
    );
    const overlay = await screen.findByRole("img", { name: "Porch" });
    fireEvent.load(overlay);
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveStyle({ touchAction: "none" });
    fireEvent.pointerDown(dialog, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 80,
    });
    fireEvent.pointerMove(dialog, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(overlay.style.transform).toBe("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses instantly when motion is reduced", async () => {
    const media = vi.mocked(window.matchMedia);
    media.mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger src={cardPixelA} alt="Porch">
          {cardPhoto(cardPixelA, "Porch card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open photo full screen: Porch" }),
    );
    await screen.findByRole("button", { name: "Close full-screen media" });
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses a second media tap for the exact entry reaction instead of opening", () => {
    const reactionTarget = document.createElement("div");
    reactionTarget.id = "moment-conversation-moment-one";
    const heart = vi.fn();
    reactionTarget.addEventListener("our-days:heart", heart);
    document.body.append(reactionTarget);

    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Family outside"
          reactionTargetId="moment-one"
        >
          <span>Photo preview</span>
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: Family outside",
    });
    fireEvent.click(trigger, { detail: 1 });
    fireEvent.click(trigger, { detail: 2 });
    expect(heart).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    reactionTarget.remove();
  });
});
