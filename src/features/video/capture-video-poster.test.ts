import { afterEach, describe, expect, it, vi } from "vitest";
import { captureVideoPoster } from "./capture-video-poster";

function jpegDataUrlApproxBytes(bytes: number) {
  const encodedLength = Math.ceil((Math.max(1, bytes) * 4) / 3);
  return `data:image/jpeg;base64,${"A".repeat(encodedLength)}`;
}

function createSeekableVideo(duration: number) {
  const video = document.createElement("video");
  let currentTime = 0;
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => duration,
  });
  Object.defineProperty(video, "videoWidth", {
    configurable: true,
    get: () => 1280,
  });
  Object.defineProperty(video, "videoHeight", {
    configurable: true,
    get: () => 720,
  });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (next: number) => {
      currentTime = next;
      queueMicrotask(() => {
        video.dispatchEvent(new Event("seeked"));
      });
    },
  });
  return { video, currentTime: () => currentTime };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureVideoPoster", () => {
  it("keeps probing into longer clips until a non-blank frame appears", async () => {
    const { video, currentTime } = createSeekableVideo(16);
    const blankPoster = jpegDataUrlApproxBytes(5_549);
    const realPoster = jpegDataUrlApproxBytes(18_000);

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() =>
      currentTime() >= 7.5 ? realPoster : blankPoster,
    );

    const captured = await captureVideoPoster(video);

    expect(captured).not.toBeNull();
    expect(captured?.looksLikelyBlank).toBe(false);
    expect(captured?.dataUrl).toBe(realPoster);
    expect(currentTime()).toBeGreaterThanOrEqual(7.5);
  });

  it("falls back to the largest capture when every probe stays blank", async () => {
    const { video, currentTime } = createSeekableVideo(10);

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() =>
      jpegDataUrlApproxBytes(4_000 + Math.floor(currentTime() * 500)),
    );

    const captured = await captureVideoPoster(video);

    expect(captured).not.toBeNull();
    expect(captured?.looksLikelyBlank).toBe(true);
    expect(captured?.byteSize).toBeGreaterThan(4_000);
  });
});
