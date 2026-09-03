import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

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

function openPhoto() {
  render(
    <FullscreenMediaViewer
      kind="photo"
      label="Family outside"
      preview={<span>Photo preview</span>}
      fullscreenMedia={<span>Full photo</span>}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Open photo full screen: Family outside",
    }),
  );
  return screen.getByText("Full photo").parentElement as HTMLElement;
}

function capturePhoto(photo: HTMLElement) {
  Object.defineProperties(photo, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => false },
  });
}

const cardPixelA =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const cardPixelB =
  "data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";

function paintableCardPhoto(src: string, alt: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={80}
      height={50}
      ref={(node) => {
        if (!node) return;
        Object.defineProperties(node, {
          naturalWidth: { configurable: true, value: 80 },
          naturalHeight: { configurable: true, value: 50 },
        });
      }}
    />
  );
}

function openNamedPhoto(label: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `Open photo full screen: ${label}`,
    }),
  );
}

describe("FullscreenMediaViewer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens a photo full screen, supports direct zoom, and returns focus on close", () => {
    render(
      <FullscreenMediaViewer
        kind="photo"
        label="Family outside"
        preview={<span>Photo preview</span>}
        fullscreenMedia={<span>Full photo</span>}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: Family outside",
    });
    const preview = screen.getByText("Photo preview");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Full-screen photo: Family outside",
    });
    expect(dialog).toBeVisible();
    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(preview).toBeVisible();
    expect(trigger).not.toHaveClass("is-open");
    expect(window.getComputedStyle(preview).visibility).not.toBe("hidden");
    expect(window.getComputedStyle(preview).opacity).not.toBe("0");
    const photo = screen.getByText("Full photo").parentElement;
    expect(photo).toHaveClass("media-viewer-photo");
    fireEvent.doubleClick(photo as HTMLElement);
    expect(photo).toHaveClass("is-zoomed");
    expect(screen.queryByRole("button", { name: /Zoom/u })).toBeNull();
    expect(screen.queryByText(/Pinch/u)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(trigger).toHaveFocus();
  });

  it("expands a photo from the card and reverses that motion on close", () => {
    vi.useFakeTimers();
    render(
      <FullscreenMediaViewer
        kind="photo"
        label="Family outside"
        preview={<span>Photo preview</span>}
        fullscreenMedia={<span>Full photo</span>}
      />,
    );
    const trigger = screen.getByRole("button", {
      name: "Open photo full screen: Family outside",
    });
    mockRect(trigger, { left: 24, top: 180, width: 342, height: 220 });
    fireEvent.click(trigger);

    const photo = screen.getByText("Full photo").parentElement as HTMLElement;
    mockRect(photo, { left: 0, top: 80, width: 390, height: 680 });
    const dimmer = document.querySelector(
      ".media-viewer-dimmer",
    ) as HTMLElement;
    expect(photo.style.transform).toBe("");
    expect(dimmer.style.opacity).toBe("1");

    mockRect(trigger, { left: 24, top: 180, width: 342, height: 220 });
    mockRect(photo, { left: 0, top: 80, width: 390, height: 680 });
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(photo.style.transform).toContain("translate3d");
    expect(photo.style.transition).toContain("ease-in");
    expect(dimmer.style.opacity).toBe("0");
    expect(screen.getByRole("dialog")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the card photo painted while a swipe dismisses the overlay", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    const photo = openPhoto();
    const preview = screen.getByText("Photo preview");
    capturePhoto(photo);

    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(preview).toBeVisible();
    expect(window.getComputedStyle(preview).visibility).not.toBe("hidden");

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
    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(preview).toBeVisible();

    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByText("Photo preview")).toBe(preview);
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(preview).toBeVisible();
  });

  it("follows a downward swipe and dismisses past a short threshold", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    const photo = openPhoto();
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
    expect(photo.style.transform).toBe(
      "translate3d(0, 120px, 0) scale(0.9808)",
    );
    expect(document.querySelector(".media-viewer-dimmer")).toHaveStyle({
      opacity: "0.808",
    });

    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(photo.style.transition).toContain("ease-in");
    expect(screen.getByRole("dialog")).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("snaps the photo and dimmer back when the swipe is short", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    const photo = openPhoto();
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
      clientX: 122,
      clientY: 120,
    });
    expect(photo.style.transform).toContain("40px");

    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 122,
      clientY: 120,
    });
    expect(photo.style.transform).toBe("");
    expect(photo.style.transition).toContain("ease-out");
    expect(document.querySelector(".media-viewer-dimmer")).toHaveStyle({
      opacity: "1",
    });
    expect(screen.getByRole("dialog")).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.getByRole("dialog")).toBeVisible();
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

    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);
    const photo = openPhoto();
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
    expect(photo.style.transform).toBe("");
    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a video with native playback controls", () => {
    render(
      <FullscreenMediaViewer
        kind="video"
        label="Family video"
        preview={<video src="/video.mp4" aria-label="Family video preview" />}
        fullscreenMedia={
          <video src="/video.mp4" aria-label="Family video" controls />
        }
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Open video full screen: Family video",
    });
    expect(trigger.querySelector("video")).not.toHaveAttribute("controls");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Full-screen video: Family video",
    });
    expect(dialog.querySelector("video")).toHaveAttribute("controls");
    expect(screen.queryByText("Rotate for a wider view")).toBeNull();
  });

  it("uses a second media tap for the exact entry reaction instead of opening", () => {
    const reactionTarget = document.createElement("div");
    reactionTarget.id = "moment-conversation-moment-one";
    const heart = vi.fn();
    reactionTarget.addEventListener("our-days:heart", heart);
    document.body.append(reactionTarget);

    render(
      <FullscreenMediaViewer
        kind="photo"
        label="Family outside"
        reactionTargetId="moment-one"
        preview={<span>Photo preview</span>}
        fullscreenMedia={<span>Full photo</span>}
      />,
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

  it("paints the overlay from a canvas copy so the card img keeps its frame", () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);

    render(
      <FullscreenMediaViewer
        kind="photo"
        label="Porch"
        preview={paintableCardPhoto(cardPixelA, "Porch card")}
        fullscreenMedia={
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cardPixelA} alt="Porch overlay" />
        }
      />,
    );
    const card = screen.getByRole("img", { name: "Porch card" });
    openNamedPhoto("Porch");

    expect(screen.getByRole("img", { name: "Porch card" })).toBe(card);
    expect(card).toBeVisible();
    expect(card).toHaveAttribute("src", cardPixelA);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(screen.queryByRole("img", { name: "Porch overlay" })).toBeNull();
    const overlay = screen.getByRole("img", { name: "Porch" });
    expect(overlay.tagName).toBe("CANVAS");
    expect(
      screen.getByRole("dialog").querySelector(`img[src="${cardPixelA}"]`),
    ).toBeNull();
  });

  it("keeps each card photo painted when two photos are opened in either order", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    render(
      <>
        <FullscreenMediaViewer
          kind="photo"
          label="First light"
          preview={paintableCardPhoto(cardPixelA, "First light card")}
          fullscreenMedia={
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardPixelA} alt="First light overlay" />
          }
        />
        <FullscreenMediaViewer
          kind="photo"
          label="Last light"
          preview={paintableCardPhoto(cardPixelB, "Last light card")}
          fullscreenMedia={
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardPixelB} alt="Last light overlay" />
          }
        />
      </>,
    );
    const first = screen.getByRole("img", { name: "First light card" });
    const last = screen.getByRole("img", { name: "Last light card" });

    openNamedPhoto("First light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(screen.getByRole("img", { name: "First light" }).tagName).toBe(
      "CANVAS",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );

    openNamedPhoto("Last light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(screen.getByRole("img", { name: "Last light" }).tagName).toBe(
      "CANVAS",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );

    openNamedPhoto("Last light");
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    openNamedPhoto("First light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(
      screen.queryByRole("img", { name: "First light overlay" }),
    ).toBeNull();
    expect(
      screen.queryByRole("img", { name: "Last light overlay" }),
    ).toBeNull();
  });
});
