import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoMomentMedia } from "./video-moment-media";

const mocks = vi.hoisted(() => ({
  warmVideoPoster: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/components/private-video-player", () => ({
  PrivateVideoPlayer: ({
    label,
    poster,
  }: Readonly<{ label: string; poster?: string }>) => (
    <video aria-label={label} poster={poster} />
  ),
}));

vi.mock("@/features/video/warm-video-poster", () => ({
  warmVideoPoster: mocks.warmVideoPoster,
}));

vi.mock("@/lib/use-private-media-object-url", () => ({
  usePrivateMediaObjectUrl: (src?: string) => ({ objectUrl: src ?? null }),
}));

class ImmediateIntersectionObserver {
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe() {
    this.callback(
      [
        {
          isIntersecting: true,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }

  takeRecords() {
    return [];
  }

  unobserve() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
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

    await waitFor(() => {
      expect(mocks.warmVideoPoster).toHaveBeenCalledWith({
        momentId: "d1af0c65-7663-46b9-afef-24c634953527",
        src: "/api/media/videos/d1af0c65-7663-46b9-afef-24c634953527",
        replaceExistingPoster: true,
      });
    });
  });

  it("warms healthy persisted posters without requesting replacement", async () => {
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

    await waitFor(() => {
      expect(mocks.warmVideoPoster).toHaveBeenCalledWith({
        momentId: "healthy-poster-moment",
        src: "/api/media/videos/healthy-poster-moment",
        replaceExistingPoster: false,
      });
    });
  });
});
