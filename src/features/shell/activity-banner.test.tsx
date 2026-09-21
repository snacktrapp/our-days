import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActivityBanner,
  activityPollMs,
  activityUpdatedEvent,
} from "./activity-banner";

const old = {
  id: "note:old",
  actorName: "Molly",
  message: "commented on your entry.",
  displayDate: "Today",
  createdAt: "2026-09-20T10:00:00Z",
  href: "/family#moment-photo",
};
const fresh = { ...old, id: "note:new", createdAt: "2026-09-20T10:01:05Z" };
const reply = (items = [old], observedAt = "2026-09-20T10:01:00Z") => ({
  ok: true,
  json: async () => ({ items, observedAt }),
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
const tick = async (ms = activityPollMs) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("live comment banner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("silently baselines history, updates the drawer, and shows a later comment once", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply())
      .mockResolvedValue(reply([fresh, old], "2026-09-20T10:01:30Z"));
    vi.stubGlobal("fetch", fetcher);
    const updated = vi.fn();
    window.addEventListener(activityUpdatedEvent, updated);
    render(<ActivityBanner />);
    await flush();
    expect(screen.queryByRole("status")).toBeNull();
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Molly commented on your entry.",
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", old.href);
    expect(updated).toHaveBeenCalledTimes(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    await tick();
    expect(screen.queryByRole("status")).toBeNull();
    window.removeEventListener(activityUpdatedEvent, updated);
  });

  it("does not poll hidden tabs or replay background comments on resume", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply())
      .mockResolvedValue(reply([fresh, old], "2026-09-20T10:01:30Z"));
    vi.stubGlobal("fetch", fetcher);
    render(<ActivityBanner />);
    await flush();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    await tick(90000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not replay old newly-visible items, reactions, or comments over a dialog", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply())
      .mockResolvedValue(
        reply([
          { ...old, id: "note:previously-hidden" },
          { ...fresh, id: "reaction:new" },
        ]),
      );
    vi.stubGlobal("fetch", fetcher);
    render(<ActivityBanner />);
    await flush();
    await tick();
    expect(screen.queryByRole("status")).toBeNull();
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.append(dialog);
    fetcher.mockResolvedValue(reply([fresh], "2026-09-20T10:01:30Z"));
    await tick();
    expect(screen.queryByRole("status")).toBeNull();
    dialog.remove();
  });

  it("recovers silently after failure and aborts on unmount", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(reply([fresh]));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<ActivityBanner />);
    await flush();
    await tick();
    await tick();
    expect(screen.queryByRole("status")).toBeNull();
    view.unmount();
    const options = fetcher.mock.calls.at(-1)![1];
    expect(options.signal.aborted).toBe(true);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("automatically dismisses after seven seconds without shifting the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(reply())
        .mockResolvedValue(reply([fresh])),
    );
    render(<ActivityBanner />);
    await flush();
    await tick();
    expect(screen.getByRole("status")).toBeVisible();
    await tick(7000);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
