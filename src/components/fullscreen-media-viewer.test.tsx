import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

describe("FullscreenMediaViewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a video with native playback controls", () => {
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
        preview={<img src="/poster.jpg" alt="" />}
        fullscreenMedia={
          <video src="/video.mp4" aria-label="Family video" controls />
        }
      />,
    );

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
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeVisible();
    expect(done.closest(".media-viewer-chrome")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "×" })).toBeNull();
    expect(screen.queryByText("Rotate for a wider view")).toBeNull();
    fireEvent.click(done);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
