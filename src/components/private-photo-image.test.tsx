// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivatePhotoImage } from "./private-photo-image";

describe("PrivatePhotoImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defers off-screen photos until their carousel approaches the viewport", async () => {
    let notify: IntersectionObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notify = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <div className="photo-card-pager">
        <PrivatePhotoImage
          src="/api/media/moments/offscreen"
          alt="Later photo"
        />
      </div>,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(view.container.firstChild);
    act(() =>
      notify(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(disconnect).toHaveBeenCalled();
  });

  it("shows authorized bytes from a credentialed blob URL", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-photo");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: async () =>
        new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PrivatePhotoImage
        src="/api/media/moments/one"
        alt="Photo in Molly’s journal from Aug 1, 2026"
        width={1200}
        height={800}
        highPriority
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Photo in Molly’s journal from Aug 1, 2026",
      }),
    ).toHaveAttribute("src", "/api/media/moments/one");
    expect(document.querySelector('link[rel="preload"]')).toHaveAttribute(
      "href",
      "/api/media/moments/one",
    );

    const image = await screen.findByRole("img", {
      name: "Photo in Molly’s journal from Aug 1, 2026",
    });
    await waitFor(() =>
      expect(image).toHaveAttribute("src", "blob:private-photo"),
    );
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "800");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/media/moments/one",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        priority: "high",
      }),
    );
  });

  it("shows a stable retry control after a private response fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        blob: async () => new Blob(),
      })
      .mockResolvedValueOnce({
        ok: true,
        blob: async () =>
          new Blob([new Uint8Array([1])], { type: "image/webp" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:private-retry");

    render(
      <PrivatePhotoImage
        src="/api/media/moments/one?photo=10000000-0000-4000-8000-000000000011"
        alt="Photo in Molly’s journal"
        width={1200}
        height={800}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("This photo couldn’t be opened.")).toBeVisible();
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/media/moments/one?photo=10000000-0000-4000-8000-000000000011&retry=1",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    expect(
      await screen.findByRole("img", { name: "Photo in Molly’s journal" }),
    ).toHaveAttribute("src", "blob:private-retry");
  });
});
