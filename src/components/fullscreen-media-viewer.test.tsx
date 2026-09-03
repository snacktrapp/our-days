import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

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

function cardPhoto(src: string, alt: string) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={80} height={50} />
  );
}

function openNamedPhoto(label: string) {
  fireEvent.click(
    screen.getByRole("button", {
      name: `Open photo full screen: ${label}`,
    }),
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

async function flushOverlayFade() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

describe("FullscreenMediaViewer", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens a photo full screen, supports direct zoom, and returns focus on close", async () => {
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
    expect(document.documentElement).not.toHaveClass("media-viewer-open");
    const photo = screen.getByText("Full photo").parentElement;
    expect(photo).toHaveClass("media-viewer-photo");
    fireEvent.doubleClick(photo as HTMLElement);
    expect(photo).toHaveClass("is-zoomed");
    expect(screen.queryByRole("button", { name: /Zoom/u })).toBeNull();
    expect(screen.queryByText(/Pinch/u)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Photo preview")).toBe(preview);
    expect(trigger).toHaveFocus();
  });

  it("fades the overlay in and out without interpolating the card", async () => {
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
    fireEvent.click(trigger);

    const photo = screen.getByText("Full photo").parentElement as HTMLElement;
    const dimmer = document.querySelector(
      ".media-viewer-dimmer",
    ) as HTMLElement;
    expect(photo.style.transform).toBe("");

    await flushOverlayFade();
    expect(photo.style.opacity).toBe("1");
    expect(dimmer.style.opacity).toBe("1");
    expect(photo.style.transform).toBe("");
    expect(photo.style.transition).toContain("opacity");
    expect(photo.style.transition).not.toContain("transform");

    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    expect(photo.style.opacity).toBe("0");
    expect(photo.style.transform).toBe("");
    expect(photo.style.transition).toContain("opacity");
    expect(photo.style.transition).not.toContain("transform");
    expect(dimmer.style.opacity).toBe("0");
    expect(screen.getByRole("dialog")).toBeVisible();

    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 180);
      });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Photo preview")).toBeVisible();
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

  it("follows a downward swipe on the overlay only and dismisses past a short threshold", () => {
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
    expect(photo.style.transform).toBe("translate3d(0, 120px, 0)");
    expect(photo.style.transform).not.toContain("scale");
    expect(document.querySelector(".media-viewer-dimmer")).toHaveStyle({
      opacity: "0.808",
    });

    fireEvent.pointerUp(photo, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 200,
    });
    expect(photo.style.transition).toContain("transform");
    expect(photo.style.transition).toContain("ease-in");
    expect(screen.getByRole("dialog")).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(180);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("snaps the overlay and dimmer back when the swipe is short", () => {
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
    expect(photo.style.transform).toBe("translate3d(0, 40px, 0)");

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

  it("decodes the overlay from a blob URL that is not the card img", async () => {
    mockIndependentOverlayDecode();

    render(
      <FullscreenMediaViewer
        kind="photo"
        label="Porch"
        overlaySrc={cardPixelA}
        preview={cardPhoto(cardPixelA, "Porch card")}
      />,
    );
    const card = screen.getByRole("img", { name: "Porch card" });
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
    openNamedPhoto("Porch");

    expect(screen.getByRole("img", { name: "Porch card" })).toBe(card);
    expect(card).toBeVisible();
    expect(card).toHaveAttribute("src", cardPixelA);
    const overlay = await screen.findByRole("img", { name: "Porch" });
    expect(overlay.tagName).toBe("IMG");
    expect(overlay).toHaveAttribute("src", "blob:overlay-1");
    expect(
      screen.getByRole("dialog").querySelector(`img[src="${cardPixelA}"]`),
    ).toBeNull();
    expect(overlay).not.toBe(card);
  });

  it("keeps each card photo painted when two photos are opened A then B then A", async () => {
    mockIndependentOverlayDecode();

    render(
      <>
        <FullscreenMediaViewer
          kind="photo"
          label="First light"
          overlaySrc={cardPixelA}
          preview={cardPhoto(cardPixelA, "First light card")}
        />
        <FullscreenMediaViewer
          kind="photo"
          label="Last light"
          overlaySrc={cardPixelB}
          preview={cardPhoto(cardPixelB, "Last light card")}
        />
      </>,
    );
    const first = screen.getByRole("img", { name: "First light card" });
    const last = screen.getByRole("img", { name: "Last light card" });
    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

    openNamedPhoto("First light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(
      await screen.findByRole("img", { name: "First light" }),
    ).toHaveAttribute("src", "blob:overlay-1");
    expect(
      screen.getByRole("dialog").querySelector(`img[src="${cardPixelA}"]`),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    openNamedPhoto("Last light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(
      await screen.findByRole("img", { name: "Last light" }),
    ).toHaveAttribute("src", "blob:overlay-2");
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    openNamedPhoto("Last light");
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    fireEvent.click(
      screen.getByRole("button", { name: "Close full-screen media" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    openNamedPhoto("First light");
    expect(screen.getByRole("img", { name: "First light card" })).toBe(first);
    expect(screen.getByRole("img", { name: "Last light card" })).toBe(last);
    expect(first).toHaveAttribute("src", cardPixelA);
    expect(last).toHaveAttribute("src", cardPixelB);
    expect(first).toBeVisible();
    expect(last).toBeVisible();
    expect(
      await screen.findByRole("img", { name: "First light" }),
    ).toHaveAttribute("src", "blob:overlay-1");
  });
});
