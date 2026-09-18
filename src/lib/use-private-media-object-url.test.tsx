// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrivateMediaObjectUrl } from "./use-private-media-object-url";

describe("usePrivateMediaObjectUrl", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ends a stalled photo request so the user can retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_src, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      usePrivateMediaObjectUrl("/api/media/moments/one"),
    );
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(result.current.failed).toBe(true);
    expect(result.current.objectUrl).toBeNull();
  });

  it("cancels the old download when switching photos or leaving the page", () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_src, init: RequestInit) => {
        signals.push(init.signal!);
        return new Promise(() => {});
      }),
    );
    const view = renderHook(({ src }) => usePrivateMediaObjectUrl(src), {
      initialProps: { src: "/api/media/moments/one" },
    });
    view.rerender({ src: "/api/media/moments/two" });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    view.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it("passes data URLs through without fetching", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      usePrivateMediaObjectUrl("data:image/jpeg;base64,abc"),
    );
    expect(result.current.objectUrl).toBe("data:image/jpeg;base64,abc");
    expect(result.current.failed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches private routes with credentials and no-store", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-photo");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () =>
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      usePrivateMediaObjectUrl("/api/media/moments/one"),
    );
    await waitFor(() => {
      expect(result.current.objectUrl).toBe("blob:private-photo");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/moments/one",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    expect(result.current.failed).toBe(false);
  });

  it("marks a 404 as failed so the card can show Try again", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      blob: async () => new Blob(),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      usePrivateMediaObjectUrl("/api/media/moments/one"),
    );
    await waitFor(() => {
      expect(result.current.failed).toBe(true);
    });
    expect(result.current.objectUrl).toBeNull();
  });
});
