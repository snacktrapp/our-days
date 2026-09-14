import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOverlayChromeForTests } from "@/features/shell/overlay-chrome";
import {
  visualViewportBottomInsetVar,
  visualViewportOffsetTopVar,
} from "@/features/shell/visual-viewport-bottom";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

describe("FullscreenMediaViewer", () => {
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    resetOverlayChromeForTests();
    document.documentElement.classList.remove("overlay-open");
    document.body.classList.remove("overlay-open");
    document.documentElement.style.removeProperty(visualViewportOffsetTopVar);
    document.documentElement.style.removeProperty(visualViewportBottomInsetVar);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
    vi.restoreAllMocks();
  });

  function renderViewer() {
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <FullscreenMediaViewer
        kind="video"
        label="Family video"
        preview={<div className="video-card-mat" aria-hidden="true" />}
        fullscreenMedia={
          <video src="/video.mp4" aria-label="Family video" controls />
        }
      />,
    );
    return play;
  }

  it("opens a video with native playback controls and an overlay Close", () => {
    const play = renderViewer();

    const trigger = screen.getByRole("button", {
      name: "Open video full screen: Family video",
    });
    expect(trigger.querySelector("video")).toBeNull();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Full-screen video: Family video",
    });
    expect(dialog.querySelector("video")).toHaveAttribute("controls");
    expect(play).toHaveBeenCalled();
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBeVisible();
    expect(close).toHaveTextContent("×");
    expect(close.closest(".media-viewer-chrome")).toBeNull();
    expect(dialog.querySelector(".media-viewer-chrome")).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.queryByText("Rotate for a wider view")).toBeNull();
    expect(document.documentElement).toHaveClass("overlay-open");
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.documentElement).not.toHaveClass("overlay-open");
  });

  it("fills a landscape visual viewport without a reserved chrome row", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetTop: 0,
        offsetLeft: 0,
        width: 844,
        height: 390,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    renderViewer();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.width).toBe("844px");
    expect(dialog.style.height).toBe("390px");
    expect(dialog.querySelector(".media-viewer-video")).not.toBeNull();
    expect(dialog.querySelector(".media-viewer-chrome")).toBeNull();
  });

  it("keeps filling the visual viewport after a rotate and restores the nav on close", async () => {
    const visualViewport = {
      offsetTop: 0,
      offsetLeft: 0,
      width: 390,
      height: 844,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "0px",
    );
    renderViewer();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.width).toBe("390px");
    expect(dialog.style.height).toBe("844px");

    visualViewport.width = 844;
    visualViewport.height = 390;
    const resize = visualViewport.addEventListener.mock.calls.find(
      ([name]) => name === "resize",
    )?.[1] as EventListener | undefined;
    resize?.(new Event("resize"));
    expect(dialog.style.width).toBe("844px");
    expect(dialog.style.height).toBe("390px");
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
    expect(dialog.querySelector(".media-viewer-chrome")).toBeNull();

    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "454px",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
    expect(document.documentElement).not.toHaveClass("overlay-open");
  });

  it("restores the bottom nav after Close, cancel, and a leftover landscape inset", async () => {
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "454px",
    );
    renderViewer();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("0px");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "454px",
    );
    fireEvent.cancel(screen.getByRole("dialog"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
  });
});
