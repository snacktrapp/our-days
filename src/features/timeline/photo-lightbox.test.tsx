import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetIndependentOverlayObjectUrlCache } from "@/components/independent-overlay-photo";
import {
  destinationBox,
  invertTransform,
  PhotoLightboxRoot,
  PhotoLightboxTrigger,
  resetPhotoLightboxSession,
  restTransform,
  safariChromeBottomReserve,
  visiblePhotoViewport,
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
  "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";

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

function capturePhoto(photo: HTMLElement) {
  Object.defineProperties(photo, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => false },
  });
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

function setSafeAreaInsets(insets: {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}) {
  const root = document.documentElement.style;
  root.setProperty("--safe-area-inset-top", `${insets.top ?? 0}px`);
  root.setProperty("--safe-area-inset-right", `${insets.right ?? 0}px`);
  root.setProperty("--safe-area-inset-bottom", `${insets.bottom ?? 0}px`);
  root.setProperty("--safe-area-inset-left", `${insets.left ?? 0}px`);
}

function clearSafeAreaInsets() {
  const root = document.documentElement.style;
  root.removeProperty("--safe-area-inset-top");
  root.removeProperty("--safe-area-inset-right");
  root.removeProperty("--safe-area-inset-bottom");
  root.removeProperty("--safe-area-inset-left");
}

describe("destinationBox", () => {
  afterEach(() => {
    clearSafeAreaInsets();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fits a tall portrait inside the visible viewport including the home indicator", () => {
    const viewport = { left: 0, top: 47, width: 390, height: 844 - 47 - 34 };
    const dest = destinationBox(1080, 2400, viewport);
    expect(dest.top).toBeGreaterThanOrEqual(viewport.top);
    expect(dest.top + dest.height).toBeLessThanOrEqual(
      viewport.top + viewport.height,
    );
    expect(dest.left).toBeGreaterThanOrEqual(viewport.left);
    expect(dest.left + dest.width).toBeLessThanOrEqual(
      viewport.left + viewport.width,
    );
    expect(dest.height).toBeCloseTo(viewport.height);
    expect(dest.width).toBeCloseTo((1080 * viewport.height) / 2400);
    expect(dest.top).toBeCloseTo(viewport.top);
  });

  it("centers a landscape photo inside the same safe viewport", () => {
    const viewport = { left: 0, top: 47, width: 390, height: 763 };
    const dest = destinationBox(1920, 1080, viewport);
    expect(dest.width).toBeCloseTo(390);
    expect(dest.height).toBeCloseTo((1080 * 390) / 1920);
    expect(dest.left).toBeCloseTo(0);
    expect(dest.top).toBeCloseTo(47 + (763 - dest.height) / 2);
    expect(dest.top + dest.height).toBeLessThanOrEqual(47 + 763);
  });

  it("reserves space for the Safari URL pill when visualViewport does not shrink", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    vi.stubGlobal("visualViewport", {
      width: 390,
      height: 844,
      offsetLeft: 0,
      offsetTop: 0,
    });
    setSafeAreaInsets({ top: 47, bottom: 34 });
    expect(visiblePhotoViewport()).toEqual({
      left: 0,
      top: 47,
      width: 390,
      height: 844 - 47 - 34 - safariChromeBottomReserve,
    });
  });

  it("uses the smaller of innerHeight and visualViewport so Safari chrome is not ignored", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 844,
    });
    vi.stubGlobal("visualViewport", {
      width: 390,
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
    });
    setSafeAreaInsets({ top: 47, bottom: 34 });
    const viewport = visiblePhotoViewport();
    expect(viewport.height).toBe(720 - 47 - 34);
    expect(viewport.top).toBe(47);
    const dest = destinationBox(1080, 2400, viewport);
    expect(dest.top).toBeGreaterThanOrEqual(viewport.top);
    expect(dest.top + dest.height).toBeLessThanOrEqual(
      viewport.top + viewport.height,
    );
    expect(dest.top).toBeCloseTo(
      viewport.top + (viewport.height - dest.height) / 2,
    );
  });
});

describe("photo lightbox", () => {
  afterEach(() => {
    resetPhotoLightboxSession();
    resetIndependentOverlayObjectUrlCache();
    clearSafeAreaInsets();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("expands a portaled overlay from the card rect without remounting the card img", async () => {
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
    const photo = overlay.parentElement as HTMLElement;
    const dest = destinationBox(80, 50);
    const origin = { left: 24, top: 180, width: 342, height: 220 };
    const stage = document.querySelector(
      ".photo-lightbox-stage",
    ) as HTMLElement;
    expect(photo).toHaveClass("photo-lightbox-photo");
    expect(photo.style.left).toBe("");
    expect(photo.style.top).toBe("");
    expect(stage).toBeTruthy();
    expect(stage.contains(photo)).toBe(true);
    expect(photo.style.transform).toBe(restTransform);
    expect(photo.style.transition).toContain("transform");
    expect(photo.style.transition).toContain("ease-out");
    expect(screen.getByRole("dialog")).toHaveClass("photo-lightbox");
    expect(screen.getByRole("dialog").closest(".timeline")).toBeNull();
    expect(screen.getByRole("dialog").closest(".photo-frame")).toBeNull();
    expect(document.body.contains(screen.getByRole("dialog"))).toBe(true);
    expect(document.body).not.toHaveClass("media-viewer-scroll-locked");
    expect(document.documentElement).not.toHaveClass("media-viewer-open");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(card);
    expect(card).toHaveAttribute("src", cardPixelA);
    expect(card).toBeVisible();
    expect(overlay).toHaveAttribute("src", "blob:overlay-1");
    expect(overlay).not.toBe(card);

    mockRect(trigger, { left: 24, top: 180, width: 342, height: 220 });
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(photo.style.transform).toBe(invertTransform(origin, dest));
    expect(photo.style.transition).toContain("ease-in");
    expect(document.querySelector(".photo-lightbox-dimmer")).toHaveStyle({
      opacity: "0",
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
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

  it("keeps a fullscreen portrait inside the safe visible viewport", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    vi.stubGlobal("visualViewport", {
      width: 390,
      height: 844,
      offsetLeft: 0,
      offsetTop: 0,
    });
    setSafeAreaInsets({ top: 47, bottom: 34 });
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Portrait"
          width={1080}
          height={2400}
        >
          {cardPhoto(cardPixelA, "Portrait card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: Portrait",
    });
    mockRect(trigger, { left: 24, top: 180, width: 220, height: 342 });
    fireEvent.click(trigger);
    await screen.findByRole("img", { name: "Portrait" });
    const photo = document.querySelector(
      ".photo-lightbox-photo",
    ) as HTMLElement;
    const stage = document.querySelector(
      ".photo-lightbox-stage",
    ) as HTMLElement;
    const viewport = visiblePhotoViewport();
    const dest = destinationBox(1080, 2400, viewport);
    expect(stage.style.left).toBe(`${viewport.left}px`);
    expect(stage.style.top).toBe(`${viewport.top}px`);
    expect(stage.style.height).toBe(`${viewport.height}px`);
    expect(photo.style.left).toBe("");
    expect(photo.style.top).toBe("");
    expect(photo.style.transform).toBe(restTransform);
    expect(dest.top).toBeGreaterThanOrEqual(viewport.top);
    expect(dest.top + dest.height).toBeLessThanOrEqual(
      viewport.top + viewport.height,
    );
    expect(dest.top).toBeCloseTo(
      viewport.top + (viewport.height - dest.height) / 2,
    );
  });

  it("centers a landscape photo in the stage instead of pinning it to a corner", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
    vi.stubGlobal("visualViewport", {
      width: 390,
      height: 844,
      offsetLeft: 0,
      offsetTop: 0,
    });
    setSafeAreaInsets({ top: 47, bottom: 34 });
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Chairs"
          width={1920}
          height={1080}
        >
          {cardPhoto(cardPixelA, "Chairs card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    mockRect(
      screen.getByRole("button", { name: "Open photo full screen: Chairs" }),
      { left: 16, top: 520, width: 358, height: 200 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open photo full screen: Chairs" }),
    );
    await screen.findByRole("img", { name: "Chairs" });
    const photo = document.querySelector(
      ".photo-lightbox-photo",
    ) as HTMLElement;
    const viewport = visiblePhotoViewport();
    const dest = destinationBox(1920, 1080, viewport);
    expect(photo.style.transform).toBe(restTransform);
    expect(photo.style.left).toBe("");
    expect(photo.style.top).toBe("");
    expect(dest.width).toBeCloseTo(viewport.width);
    expect(dest.top).toBeGreaterThan(viewport.top);
    expect(dest.top).toBeCloseTo(
      viewport.top + (viewport.height - dest.height) / 2,
    );
    expect(dest.top + dest.height).toBeLessThan(844 - 34);
  });

  it("tracks a swipe on the overlay and reverses to the card", async () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    mockIndependentOverlayDecode();
    render(
      <PhotoLightboxRoot>
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Porch"
          width={80}
          height={50}
        >
          {cardPhoto(cardPixelA, "Porch card")}
        </PhotoLightboxTrigger>
      </PhotoLightboxRoot>,
    );
    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: Porch",
    });
    mockRect(trigger, { left: 24, top: 180, width: 342, height: 220 });
    fireEvent.click(trigger);
    await screen.findByRole("img", { name: "Porch" });
    const photo = document.querySelector(
      ".photo-lightbox-photo",
    ) as HTMLElement;
    capturePhoto(photo);
    vi.useFakeTimers();

    fireEvent.pointerDown(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 80,
    });
    fireEvent.pointerMove(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(photo.style.transform).toBe("translate3d(0, 120px, 0)");
    expect(document.querySelector(".photo-lightbox-dimmer")).toHaveStyle({
      opacity: "0.808",
    });

    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(photo.style.transform).toContain("scale");
    expect(photo.style.transition).toContain("ease-in");
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Porch card" })).toBeVisible();
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
        <PhotoLightboxTrigger
          src={cardPixelA}
          alt="Porch"
          width={80}
          height={50}
        >
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
