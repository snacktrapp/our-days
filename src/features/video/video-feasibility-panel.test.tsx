import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoFeasibilityPanel } from "./video-feasibility-panel";

let createdUrlCount = 0;
const createObjectURL = vi.fn(
  () => `blob:video-feasibility-${++createdUrlCount}`,
);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createdUrlCount = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openPreview() {
  const user = userEvent.setup({ applyAccept: false });
  render(<VideoFeasibilityPanel />);
  const trigger = screen.getByRole("button", { name: "Try a short video" });
  await user.click(trigger);
  return { trigger, user };
}

function markPlayable(
  video: HTMLVideoElement,
  values: Readonly<{ duration: number; width: number; height: number }>,
) {
  Object.defineProperties(video, {
    duration: { configurable: true, value: values.duration },
    videoWidth: { configurable: true, value: values.width },
    videoHeight: { configurable: true, value: values.height },
  });
  fireEvent.loadedMetadata(video);
  fireEvent.loadedData(video);
}

describe("VideoFeasibilityPanel", () => {
  it("keeps the experiment separate, modal, and honest", async () => {
    const { trigger, user } = await openPreview();
    expect(
      screen.getByRole("heading", { name: "Try one short video" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Local feasibility preview · Nothing is uploaded or saved",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Choose a short video")).toHaveFocus();
    expect(document.body).toHaveClass("composer-scroll-locked");

    await user.click(
      screen.getByRole("button", {
        name: "Close video feasibility preview",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body).not.toHaveClass("composer-scroll-locked");
  });

  it("rejects unsafe declared type, empty bytes, and oversized bytes before creating a URL", async () => {
    const { user } = await openPreview();
    const picker = screen.getByLabelText("Choose a short video");

    await user.upload(
      picker,
      new File(["not video"], "private-name.txt", { type: "text/plain" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose an MP4, MOV, M4V, or WebM video.",
    );
    expect(createObjectURL).not.toHaveBeenCalled();

    await user.upload(
      picker,
      new File([], "private-name.mov", { type: "video/quicktime" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("That video is empty.");
    expect(createObjectURL).not.toHaveBeenCalled();

    const oversized = new File(["video"], "private-name.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(oversized, "size", {
      value: 100 * 1024 * 1024 + 1,
    });
    await user.upload(picker, oversized);
    expect(screen.getByRole("alert")).toHaveTextContent("smaller than 100 MB");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByText(/private-name/u)).not.toBeInTheDocument();
  });

  it("recovers when the browser cannot create a local object URL", async () => {
    const { user } = await openPreview();
    createObjectURL.mockImplementationOnce(() => {
      throw new Error("synthetic browser failure");
    });
    await user.upload(
      screen.getByLabelText("Choose a short video"),
      new File(["video"], "private.mp4", { type: "video/mp4" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not be opened on this device",
    );
    expect(screen.queryByLabelText("Selected video preview")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("requires metadata and a decodable frame, never exposes the filename, and cleans up on close", async () => {
    const { trigger, user } = await openPreview();
    const picker = screen.getByLabelText("Choose a short video");
    await user.upload(
      picker,
      new File(["video bytes"], "private-family-name.mov", {
        type: "video/quicktime",
      }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking this clip on your device",
    );
    expect(screen.queryByText(/private-family-name/u)).not.toBeInTheDocument();

    const video = screen.getByLabelText("Selected video preview");
    Object.defineProperties(video, {
      duration: { configurable: true, value: 12.2 },
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 },
    });
    fireEvent.loadedMetadata(video);
    expect(screen.getByRole("status")).toHaveTextContent("Checking this clip");
    fireEvent.loadedData(video);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Clip ready to preview · 13 seconds",
    );

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(
      screen.getByRole("button", { name: "Close local preview" }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: "Close local preview" }),
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:video-feasibility-1");
    expect(trigger).toHaveFocus();
  });

  it.each([
    [
      "unreadable duration",
      Number.NaN,
      1920,
      1080,
      "duration could not be read",
    ],
    ["too long", 60.6, 1920, 1080, "about 60 seconds or shorter"],
    ["missing dimensions", 20, 0, 0, "picture size is not supported"],
    ["oversized dimensions", 20, 4096, 2304, "picture size is not supported"],
  ])(
    "rejects %s metadata and revokes its object URL",
    async (_label, duration, width, height, message) => {
      const { user } = await openPreview();
      await user.upload(
        screen.getByLabelText("Choose a short video"),
        new File(["video bytes"], "private.mp4", { type: "video/mp4" }),
      );
      const video = screen.getByLabelText("Selected video preview");
      Object.defineProperties(video, {
        duration: { configurable: true, value: duration },
        videoWidth: { configurable: true, value: width },
        videoHeight: { configurable: true, value: height },
      });
      fireEvent.loadedMetadata(video);
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(screen.queryByLabelText("Selected video preview")).toBeNull();
    },
  );

  it("ignores stale media events after replacement and revokes each URL once", async () => {
    const { user } = await openPreview();
    const picker = screen.getByLabelText("Choose a short video");
    await user.upload(
      picker,
      new File(["first"], "first.m4v", { type: "video/x-m4v" }),
    );
    const staleVideo = screen.getByLabelText(
      "Selected video preview",
    ) as HTMLVideoElement;

    await user.upload(picker, new File(["second"], "second.m4v", { type: "" }));
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    markPlayable(staleVideo, { duration: 80, width: 1920, height: 1080 });
    expect(screen.queryByRole("alert")).toBeNull();

    const currentVideo = screen.getByLabelText(
      "Selected video preview",
    ) as HTMLVideoElement;
    markPlayable(currentVideo, { duration: 8, width: 1080, height: 1920 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Clip ready to preview · 8 seconds",
    );
    await user.click(screen.getByRole("button", { name: "Remove video" }));
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      1,
      "blob:video-feasibility-1",
    );
    expect(revokeObjectURL).toHaveBeenNthCalledWith(
      2,
      "blob:video-feasibility-2",
    );
    expect(screen.getByLabelText("Choose a short video")).toHaveFocus();
  });

  it("accepts a frame before metadata and silences inspection timers once ready", async () => {
    vi.useFakeTimers();
    render(<VideoFeasibilityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Try a short video" }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    fireEvent.change(screen.getByLabelText("Choose a short video"), {
      target: {
        files: [new File(["video"], "private.mp4", { type: "video/mp4" })],
      },
    });

    const video = screen.getByLabelText(
      "Selected video preview",
    ) as HTMLVideoElement;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 4.2 },
      videoWidth: { configurable: true, value: 160 },
      videoHeight: { configurable: true, value: 90 },
    });
    fireEvent.loadedData(video);
    expect(screen.getByRole("status")).toHaveTextContent("Checking this clip");
    fireEvent.loadedMetadata(video);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Clip ready to preview · 5 seconds",
    );

    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Clip ready to preview · 5 seconds",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it("announces slow inspection, times out safely, and restores input focus", async () => {
    vi.useFakeTimers();
    render(<VideoFeasibilityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Try a short video" }));
    await act(() => vi.advanceTimersByTimeAsync(20));
    fireEvent.change(screen.getByLabelText("Choose a short video"), {
      target: {
        files: [new File(["video"], "private.mp4", { type: "video/mp4" })],
      },
    });

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Still checking this clip",
    );
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "took too long to inspect",
    );
    await act(() => vi.advanceTimersByTimeAsync(20));
    expect(screen.getByLabelText("Choose a short video")).toHaveFocus();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes an active object URL exactly once when the route unmounts", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { unmount } = render(<VideoFeasibilityPanel />);
    await user.click(screen.getByRole("button", { name: "Try a short video" }));
    await user.upload(
      screen.getByLabelText("Choose a short video"),
      new File(["video"], "private.webm", { type: "video/webm" }),
    );
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
