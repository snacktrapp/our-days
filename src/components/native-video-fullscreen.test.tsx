import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeVideoFullscreen } from "./native-video-fullscreen";

const originalWebkitEnterFullscreen = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  "webkitEnterFullscreen",
);
const originalWebkitSupportsFullscreen = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  "webkitSupportsFullscreen",
);
const originalRequestFullscreen = Object.getOwnPropertyDescriptor(
  HTMLVideoElement.prototype,
  "requestFullscreen",
);

function restoreProperty(
  name: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(HTMLVideoElement.prototype, name, descriptor);
  } else {
    Reflect.deleteProperty(HTMLVideoElement.prototype, name);
  }
}

describe("NativeVideoFullscreen", () => {
  const play = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn();

  afterEach(() => {
    restoreProperty("webkitEnterFullscreen", originalWebkitEnterFullscreen);
    restoreProperty(
      "webkitSupportsFullscreen",
      originalWebkitSupportsFullscreen,
    );
    restoreProperty("requestFullscreen", originalRequestFullscreen);
    vi.restoreAllMocks();
    play.mockClear();
    pause.mockClear();
  });

  function renderPlayer() {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: play,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: pause,
    });
    const result = render(
      <div className="phone-stage">
        <NativeVideoFullscreen
          src="/family-video.mp4"
          label="Family video"
          poster="/family-video.jpg"
          preview={<span>Video preview</span>}
        />
      </div>,
    );
    return result.container.querySelector<HTMLElement>(".phone-stage")!;
  }

  it("keeps one video mounted and enters native iOS fullscreen on its first tap", async () => {
    const webkitEnterFullscreen = vi.fn(function (this: HTMLVideoElement) {
      this.dispatchEvent(new Event("webkitbeginfullscreen"));
    });
    Object.defineProperties(HTMLVideoElement.prototype, {
      webkitEnterFullscreen: {
        configurable: true,
        value: webkitEnterFullscreen,
      },
      webkitSupportsFullscreen: {
        configurable: true,
        value: true,
      },
    });
    const stage = renderPlayer();
    stage.scrollTop = 240;

    const trigger = screen.getByRole("button", {
      name: "Open video full screen: Family video",
    });
    const video = screen.getByLabelText("Family video");
    expect(video).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger, { detail: 1 });

    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(video).toHaveAttribute("controls");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();

    stage.scrollTop = 0;
    fireEvent(video, new Event("webkitendfullscreen"));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(pause).toHaveBeenCalled();
    expect(video).not.toHaveAttribute("controls");
    expect(stage.scrollTop).toBe(240);
  });

  it("uses the standard element fullscreen API outside iOS", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLVideoElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    renderPlayer();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("plays inline with native controls when fullscreen is unavailable", async () => {
    renderPlayer();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );

    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Family video")).toHaveAttribute("controls");
    expect(
      screen.queryByRole("button", {
        name: "Open video full screen: Family video",
      }),
    ).toBeNull();
  });

  it("uses synchronous iOS playback when metadata is not ready", () => {
    const webkitEnterFullscreen = vi.fn();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperties(HTMLVideoElement.prototype, {
      webkitEnterFullscreen: {
        configurable: true,
        value: webkitEnterFullscreen,
      },
      webkitSupportsFullscreen: {
        configurable: true,
        value: false,
      },
      requestFullscreen: {
        configurable: true,
        value: requestFullscreen,
      },
    });
    renderPlayer();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open video full screen: Family video",
      }),
    );

    expect(play).toHaveBeenCalledOnce();
    expect(webkitEnterFullscreen).not.toHaveBeenCalled();
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
