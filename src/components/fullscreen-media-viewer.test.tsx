import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullscreenMediaViewer } from "./fullscreen-media-viewer";

describe("FullscreenMediaViewer", () => {
  it("opens a photo full screen, toggles zoom, and returns focus on close", () => {
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
    const zoom = screen.getByRole("button", { name: "Zoom in" });
    fireEvent.click(zoom);
    expect(zoom).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Fit to screen")).toBeVisible();

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
    expect(screen.getByText("Rotate for a wider view")).toBeVisible();
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
