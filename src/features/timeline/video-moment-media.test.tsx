import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoMomentMedia } from "./video-moment-media";

const mocks = vi.hoisted(() => ({
  warmVideoPoster: vi.fn().mockResolvedValue(true),
  usePrivateMediaObjectUrl: vi.fn((src?: string) => ({
    objectUrl: src ?? null,
  })),
}));

vi.mock("@/components/private-video-player", () => ({
  PrivateVideoPlayer: ({
    label,
    poster,
    preload,
    onReadyFrame,
  }: Readonly<{
    label: string;
    poster?: string;
    preload?: "none" | "metadata" | "auto";
    onReadyFrame?: unknown;
  }>) => (
    <video
      aria-label={label}
      poster={poster}
      data-preload={preload}
      data-has-ready-frame={onReadyFrame ? "yes" : "no"}
    />
  ),
}));

vi.mock("@/features/video/warm-video-poster", () => ({
  warmVideoPoster: mocks.warmVideoPoster,
}));

vi.mock("@/lib/use-private-media-object-url", () => ({
  usePrivateMediaObjectUrl: mocks.usePrivateMediaObjectUrl,
}));

class ControlledIntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect() {}

  observe() {}

  trigger(isIntersecting = true) {
    this.callback(
      [
        {
          isIntersecting,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}

  static triggerAll() {
    for (const observer of ControlledIntersectionObserver.instances) {
      observer.trigger(true);
    }
  }

  static reset() {
    ControlledIntersectionObserver.instances = [];
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  ControlledIntersectionObserver.reset();
  vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);
});

describe("VideoMomentMedia poster warmup", () => {
  it("requests replacement warmup for suspiciously tiny persisted posters", async () => {
    render(
      <VideoMomentMedia
        moment={{
          id: "d1af0c65-7663-46b9-afef-24c634953527",
          video: {
            src: "/api/media/videos/d1af0c65-7663-46b9-afef-24c634953527",
            poster:
              "/api/media/videos/d1af0c65-7663-46b9-afef-24c634953527/poster",
            posterSizeBytes: 5_549,
            width: 1280,
            height: 720,
          },
        }}
        label="Lex clip"
      />,
    );

    expect(mocks.usePrivateMediaObjectUrl).toHaveBeenCalledWith(undefined);
    await waitFor(() =>
      expect(ControlledIntersectionObserver.instances.length).toBeGreaterThan(
        0,
      ),
    );
    ControlledIntersectionObserver.triggerAll();
    await waitFor(() => {
      expect(mocks.warmVideoPoster).toHaveBeenCalledWith({
        momentId: "d1af0c65-7663-46b9-afef-24c634953527",
        src: "/api/media/videos/d1af0c65-7663-46b9-afef-24c634953527",
        replaceExistingPoster: true,
      });
    });
    await waitFor(() => {
      expect(mocks.usePrivateMediaObjectUrl).toHaveBeenLastCalledWith(
        "/api/media/videos/d1af0c65-7663-46b9-afef-24c634953527/poster",
      );
    });
    expect(screen.getByLabelText("Lex clip")).toHaveAttribute(
      "data-preload",
      "auto",
    );
    expect(screen.getByLabelText("Lex clip")).toHaveAttribute(
      "data-has-ready-frame",
      "yes",
    );
  });

  it("skips warmup and frame capture when the server poster looks good", async () => {
    render(
      <VideoMomentMedia
        moment={{
          id: "healthy-poster-moment",
          video: {
            src: "/api/media/videos/healthy-poster-moment",
            poster: "/api/media/videos/healthy-poster-moment/poster",
            posterSizeBytes: 24_000,
            width: 1280,
            height: 720,
          },
        }}
        label="Healthy clip"
      />,
    );

    expect(mocks.usePrivateMediaObjectUrl).toHaveBeenCalledWith(undefined);
    await waitFor(() =>
      expect(ControlledIntersectionObserver.instances.length).toBeGreaterThan(
        0,
      ),
    );
    ControlledIntersectionObserver.triggerAll();
    await waitFor(() => {
      expect(mocks.usePrivateMediaObjectUrl).toHaveBeenLastCalledWith(
        "/api/media/videos/healthy-poster-moment/poster",
      );
    });
    expect(mocks.warmVideoPoster).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Healthy clip")).toHaveAttribute(
      "data-preload",
      "metadata",
    );
    expect(screen.getByLabelText("Healthy clip")).toHaveAttribute(
      "data-has-ready-frame",
      "no",
    );
  });

  it("warms posters when the server has no poster yet", async () => {
    render(
      <VideoMomentMedia
        moment={{
          id: "missing-server-poster",
          video: {
            src: "/api/media/videos/missing-server-poster",
            poster: undefined,
            posterSizeBytes: undefined,
            width: 1280,
            height: 720,
          },
        }}
        label="Missing poster clip"
      />,
    );

    await waitFor(() =>
      expect(ControlledIntersectionObserver.instances.length).toBeGreaterThan(
        0,
      ),
    );
    ControlledIntersectionObserver.triggerAll();
    await waitFor(() => {
      expect(mocks.warmVideoPoster).toHaveBeenCalledWith({
        momentId: "missing-server-poster",
        src: "/api/media/videos/missing-server-poster",
        replaceExistingPoster: false,
      });
    });
    expect(screen.getByLabelText("Missing poster clip")).toHaveAttribute(
      "data-preload",
      "auto",
    );
  });
});
