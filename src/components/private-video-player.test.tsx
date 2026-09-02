import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivateVideoPlayer } from "./private-video-player";

describe("PrivateVideoPlayer", () => {
  it("uses quiet inline controls without exposing a download control", () => {
    render(
      <PrivateVideoPlayer src="/api/media/videos/one" label="Family video" />,
    );
    const video = screen.getByLabelText("Family video");
    expect(video).toHaveAttribute("src", "/api/media/videos/one");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute(
      "controlslist",
      "nodownload noremoteplayback",
    );
    expect(video).toHaveAttribute("preload", "metadata");
  });

  it("offers a local retry when private delivery fails", () => {
    render(
      <PrivateVideoPlayer src="/api/media/videos/one" label="Family video" />,
    );
    fireEvent.error(screen.getByLabelText("Family video"));
    expect(screen.getByText("This video couldn’t be opened.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByLabelText("Family video")).toBeVisible();
  });

  it("can render a quiet card preview without nested playback controls", () => {
    render(
      <PrivateVideoPlayer
        src="/api/media/videos/one"
        label="Family video"
        controls={false}
      />,
    );
    expect(screen.getByLabelText("Family video")).not.toHaveAttribute(
      "controls",
    );
  });
});
