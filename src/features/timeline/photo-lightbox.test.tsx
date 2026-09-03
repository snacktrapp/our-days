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

describe("photo lightbox", () => {
  afterEach(() => {
    resetPhotoLightboxSession();
    resetIndependentOverlayObjectUrlCache();
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
    expect(photo).toHaveClass("photo-lightbox-photo");
    expect(photo.style.left).toBe(`${dest.left}px`);
    expect(photo.style.top).toBe(`${dest.top}px`);
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

  it("tracks a swipe on the overlay and reverses to the card", () => {
    vi.useFakeTimers();
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
    const photo = document.querySelector(
      ".photo-lightbox-photo",
    ) as HTMLElement;
    capturePhoto(photo);

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

  it("dismisses instantly when motion is reduced", () => {
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
