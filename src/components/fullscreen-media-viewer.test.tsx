import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

describe("FullscreenMediaViewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
