/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearNotificationLandingGuard,
  NotificationArrival,
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
    topbar.getBoundingClientRect = () => ({
      ...box(0),
      height: 48,
      bottom: 48,
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

    expect(tops).toEqual([700 - 48 - 16]);
    expect(window.location.search).toBe("");
    expect(article.classList.contains("notification-target")).toBe(true);

    threadDoc = 860;
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops).toEqual([636, 796]);
    expect(window.scrollY).toBe(796);

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    window.dispatchEvent(new Event("scroll"));
    threadDoc = 1100;
    timeline.append(document.createElement("p"));
    ResizeObserverStub.instances.at(-1)?.fire();
    expect(tops).toEqual([636, 796]);
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
    expect(tops.at(-1)).toBe(1200 - 48 - 16);
    expect(window.location.search).toBe("");
    expect(note.isConnected).toBe(true);
  });
});
