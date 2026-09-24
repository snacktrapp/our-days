/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearNotificationLandingGuard,
  NotificationArrival,
  notificationTopInset,
} from "./notification-arrival";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback([], this);
  }
}

function box(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 100,
    bottom: top + 40,
    width: 100,
    height: 40,
    toJSON() {
      return {};
    },
  };
}

describe("notification arrival landing", () => {
  afterEach(() => {
    cleanup();
    clearNotificationLandingGuard();
    document.body.replaceChildren();
    vi.useRealTimers();
    ResizeObserverStub.instances = [];
    navigation.push.mockReset();
    navigation.replace.mockReset();
  });

  it("scrolls once, anchors a later shift, then releases after the reader scrolls", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 5000,
    });
    const tops: number[] = [];
    window.scrollTo = ((options?: ScrollToOptions) => {
      const top = options?.top ?? 0;
      tops.push(top);
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: top,
      });
    }) as typeof window.scrollTo;
    window.history.replaceState(null, "", "/family?moment=kitchen&thread=1");
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    const topbar = document.createElement("header");
    topbar.className = "topbar";
    topbar.style.top = "59px";
    Object.defineProperty(topbar, "offsetHeight", {
      configurable: true,
      value: 56,
    });
    topbar.getBoundingClientRect = () => ({
      ...box(0),
      height: 20,
      bottom: 8,
    });
    const article = document.createElement("article");
    article.id = "moment-kitchen";
    article.getBoundingClientRect = () => box(640 - window.scrollY);
    const thread = document.createElement("div");
    thread.className = "inline-conversation";
    let threadDoc = 700;
    thread.getBoundingClientRect = () => box(threadDoc - window.scrollY);
    article.append(thread);
    timeline.append(article);
    document.body.append(topbar, timeline);

    render(<NotificationArrival />);

    expect(notificationTopInset()).toBe(59 + 56 + 16);
    expect(tops).toEqual([700 - (59 + 56 + 16)]);
    expect(window.location.search).toBe("");
    expect(article.classList.contains("notification-target")).toBe(true);

    threadDoc = 860;
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops).toEqual([569, 860 - (59 + 56 + 16)]);
    expect(window.scrollY).toBe(860 - (59 + 56 + 16));

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    window.dispatchEvent(new Event("scroll"));
    threadDoc = 1100;
    timeline.append(document.createElement("p"));
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops).toEqual([569, 860 - (59 + 56 + 16)]);
    expect(window.scrollY).toBe(0);

    const lake = document.createElement("article");
    lake.id = "moment-lake";
    const note = document.createElement("li");
    note.id = "note-lake-note";
    note.getBoundingClientRect = () => box(1200 - window.scrollY);
    lake.append(note);
    timeline.append(lake);
    window.history.pushState(
      null,
      "",
      "/family?moment=lake&note=lake-note&thread=1",
    );
    expect(tops.at(-1)).toBe(1200 - (59 + 56 + 16));
    expect(window.location.search).toBe("");
    expect(note.isConnected).toBe(true);
  });

  it("keeps the anchor when the landing scroll event arrives late", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 5000,
    });
    const tops: number[] = [];
    let reportedY = 0;
    let applyScroll = false;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => reportedY,
    });
    window.scrollTo = ((options?: ScrollToOptions) => {
      const top = options?.top ?? 0;
      tops.push(top);
      if (applyScroll) reportedY = top;
    }) as typeof window.scrollTo;
    window.history.replaceState(null, "", "/family?moment=porch&thread=1");
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    const article = document.createElement("article");
    article.id = "moment-porch";
    const thread = document.createElement("div");
    thread.className = "inline-conversation";
    let threadDoc = 900;
    thread.getBoundingClientRect = () => box(threadDoc - reportedY);
    article.append(thread);
    timeline.append(article);
    document.body.append(timeline);

    render(<NotificationArrival />);
    expect(tops.length).toBeGreaterThan(0);
    expect(tops.every((top) => top === 900 - 16)).toBe(true);
    const landingTops = tops.length;
    window.dispatchEvent(new Event("scroll"));
    expect(tops).toHaveLength(landingTops);

    applyScroll = true;
    reportedY = 900 - 16;
    window.dispatchEvent(new Event("scroll"));
    threadDoc = 900 + 480;
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops.at(-1)).toBe(900 + 480 - 16);

    reportedY = 0;
    window.dispatchEvent(new Event("scroll"));
    threadDoc = 900 + 480 + 360;
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops.at(-1)).toBe(900 + 480 - 16);
  });

  it("does not land again when refresh writes the comment query back", () => {
    const tops: number[] = [];
    window.scrollTo = ((options?: ScrollToOptions) => {
      const top = options?.top ?? 0;
      tops.push(top);
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: top,
      });
    }) as typeof window.scrollTo;
    window.history.replaceState(
      null,
      "",
      "/family?moment=kitchen&note=kitchen-note&thread=1",
    );
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    const article = document.createElement("article");
    article.id = "moment-kitchen";
    const note = document.createElement("li");
    note.id = "note-kitchen-note";
    note.getBoundingClientRect = () => box(900 - window.scrollY);
    article.append(note);
    timeline.append(article);
    document.body.append(timeline);

    render(<NotificationArrival />);
    expect(tops).toHaveLength(1);
    expect(window.location.search).toBe("");

    window.history.replaceState(
      { __NA: true },
      "",
      "/family?moment=kitchen&note=kitchen-note&thread=1",
    );
    expect(tops).toHaveLength(1);
    expect(window.location.search).toBe("");
    expect(navigation.replace).toHaveBeenCalledWith("/family", {
      scroll: false,
    });
  });

  it("a reload of a consumed comment target stays at the top", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");
    sessionStorage.setItem(
      "our-days:notification-consumed",
      "kitchen\nkitchen-note\n1",
    );
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { type: "reload" } as unknown as PerformanceEntry,
    ]);
    window.history.replaceState(
      null,
      "",
      "/family?moment=kitchen&note=kitchen-note&thread=1",
    );
    const article = document.createElement("article");
    article.id = "moment-kitchen";
    const note = document.createElement("li");
    note.id = "note-kitchen-note";
    note.getBoundingClientRect = () => box(900 - window.scrollY);
    article.append(note);
    document.body.append(article);

    render(<NotificationArrival />);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    scrollTo.mockRestore();
  });
});
