import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineRefreshControl } from "./timeline-refresh-control";
import { pullThresholdPx } from "./timeline-pull-to-refresh";

const navigation = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

function dispatchTouch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  clientX: number,
  clientY: number,
  target: EventTarget = document,
) {
  const touchTarget = target instanceof Element ? target : document.body;
  const touch = {
    identifier: 1,
    target: touchTarget,
    clientX,
    clientY,
    pageX: clientX,
    pageY: clientY,
    screenX: clientX,
    screenY: clientY,
    radiusX: 2,
    radiusY: 2,
    rotationAngle: 0,
    force: 1,
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: {
      value: type === "touchend" || type === "touchcancel" ? [] : [touch],
    },
    targetTouches: {
      value: type === "touchend" || type === "touchcancel" ? [] : [touch],
    },
    changedTouches: { value: [touch] },
  });
  target.dispatchEvent(event);
}

function pullFrom(startY: number, distance: number, dx = 0) {
  dispatchTouch("touchstart", 180, startY);
  dispatchTouch("touchmove", 180 + dx / 2, startY + distance / 2);
  dispatchTouch("touchmove", 180 + dx, startY + distance);
  dispatchTouch("touchend", 180 + dx, startY + distance);
}

describe("TimelineRefreshControl", () => {
  beforeEach(() => {
    navigation.refresh.mockReset();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    document.documentElement.className = "";
    document.body.className = "";
    const live = document.createElement("p");
    live.id = "journal-live-region";
    live.setAttribute("aria-live", "assertive");
    document.body.append(live);
  });

  afterEach(() => {
    document.getElementById("journal-live-region")?.remove();
    document.documentElement.className = "";
    document.body.className = "";
  });

  it("refreshes the timeline after a pull past the threshold", async () => {
    render(
      <TimelineRefreshControl>
        <section className="timeline">Moments</section>
      </TimelineRefreshControl>,
    );

    const shell = document.querySelector(".timeline-pull-shell");
    expect(shell).toHaveAttribute("data-pull-state", "idle");

    act(() => {
      pullFrom(200, pullThresholdPx + 20);
    });

    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(shell).toHaveAttribute("data-pull-state", "refreshing");
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(document.getElementById("journal-live-region")).toHaveTextContent(
      "Checking for newer days.",
    );

    await waitFor(() => {
      expect(shell).toHaveAttribute("data-pull-state", "idle");
    });
    expect(shell).not.toHaveAttribute("aria-busy");
  });

  it("does not refresh a short pull, a sideways swipe, or a mid-feed drag", () => {
    render(
      <TimelineRefreshControl>
        <section className="timeline">Moments</section>
      </TimelineRefreshControl>,
    );

    act(() => {
      pullFrom(200, 24);
    });
    expect(navigation.refresh).not.toHaveBeenCalled();

    act(() => {
      pullFrom(200, 80, 90);
    });
    expect(navigation.refresh).not.toHaveBeenCalled();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 140,
    });
    act(() => {
      pullFrom(200, pullThresholdPx + 20);
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("does not steal composer lock or the photo lightbox", () => {
    render(
      <TimelineRefreshControl>
        <section className="timeline">Moments</section>
      </TimelineRefreshControl>,
    );

    document.body.classList.add("composer-scroll-locked");
    act(() => {
      pullFrom(200, pullThresholdPx + 20);
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
    document.body.classList.remove("composer-scroll-locked");

    document.documentElement.classList.add("overlay-open");
    act(() => {
      pullFrom(200, pullThresholdPx + 20);
    });
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("keeps the refresh mark still when motion is reduced", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(
      <TimelineRefreshControl>
        <section className="timeline">Moments</section>
      </TimelineRefreshControl>,
    );

    act(() => {
      pullFrom(200, pullThresholdPx + 20);
    });

    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Moments")).toBeInTheDocument();
    const mark = document.querySelector(".timeline-refresh-mark");
    expect(mark).not.toBeNull();
  });
});
