import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

describe("FullscreenMediaViewer", () => {
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
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Full-screen photo: Family outside",
    });
    expect(dialog).toBeVisible();
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
    expect(trigger).toHaveFocus();
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
});
