import { afterEach, describe, expect, it, vi } from "vitest";
import {
  albumFeedScroller,
  albumFrameOnScreen,
  albumScrollLockedByPull,
  createAlbumCenterFollower,
  nextAlbumCenterScroll,
} from "./album-frame-scroll";

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
  vi.unstubAllGlobals();
});

describe("album center scroll", () => {
  it("splits a height change across the top and bottom, and never scrolls above the page", () => {
    expect(nextAlbumCenterScroll(80, 40)).toBe(100);
    expect(nextAlbumCenterScroll(80, -20)).toBe(70);
    expect(nextAlbumCenterScroll(6, -40)).toBe(0);
    expect(nextAlbumCenterScroll(0, 30)).toBe(15);
  });

  it("treats a frame that misses the viewport as off-screen", () => {
    expect(albumFrameOnScreen({ top: 20, bottom: 200 }, 800)).toBe(true);
    expect(albumFrameOnScreen({ top: 900, bottom: 1100 }, 800)).toBe(false);
    expect(albumFrameOnScreen({ top: -400, bottom: -10 }, 800)).toBe(false);
  });

  it("holds still while pull-to-refresh owns the feed", () => {
    expect(albumScrollLockedByPull(document)).toBe(false);
    const shell = document.createElement("div");
    shell.className = "timeline-pull-shell";
    shell.dataset.pullState = "pulling";
    document.body.append(shell);
    expect(albumScrollLockedByPull(document)).toBe(true);
    shell.dataset.pullState = "idle";
    expect(albumScrollLockedByPull(document)).toBe(false);
  });

  it("scrolls the phone stage when that element is the feed scroller", () => {
    const stage = document.createElement("section");
    stage.className = "phone-stage";
    Object.defineProperty(stage, "scrollHeight", { value: 2000 });
    Object.defineProperty(stage, "clientHeight", { value: 800 });
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      () => ({ overflowY: "auto" }) as CSSStyleDeclaration,
    );
    const frame = document.createElement("div");
    stage.append(frame);
    document.body.append(stage);
    expect(albumFeedScroller(frame)).toBe(stage);
  });
});

describe("createAlbumCenterFollower", () => {
  function mountStage() {
    const stage = document.createElement("div");
    let height = 200;
    let top = 120;
    stage.getBoundingClientRect = () =>
      ({
        width: 390,
        height,
        top,
        bottom: top + height,
        left: 0,
        right: 390,
        x: 0,
        y: top,
        toJSON() {},
      }) as DOMRect;
    document.body.append(stage);
    document.documentElement.scrollTop = 40;
    const follower = createAlbumCenterFollower(stage);
    return {
      stage,
      follower,
      setHeight(next: number) {
        height = next;
      },
      setTop(next: number) {
        top = next;
      },
    };
  }

  it("moves the feed by half the height change while the frame is on screen", () => {
    const view = mountStage();
    view.setHeight(280);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(80);
  });

  it("does not move the feed for an off-screen post", () => {
    const view = mountStage();
    view.setTop(1200);
    view.setHeight(400);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(40);
  });

  it("does not fight a pull or a scroll the user started", () => {
    const view = mountStage();
    const shell = document.createElement("div");
    shell.className = "timeline-pull-shell";
    shell.dataset.pullState = "armed";
    document.body.append(shell);
    view.setHeight(280);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(40);
    shell.dataset.pullState = "idle";
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(40);

    window.dispatchEvent(new Event("scroll"));
    view.setHeight(360);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(40);

    view.follower.releaseUser();
    view.setHeight(440);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(80);

    window.dispatchEvent(new Event("scroll"));
    view.setHeight(480);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(100);
  });

  it("does not recurse when requestAnimationFrame runs the callback immediately", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const view = mountStage();
    view.setHeight(280);
    expect(() => view.follower.sync(false)).not.toThrow();
    expect(document.documentElement.scrollTop).toBe(80);
    view.follower.stop();
  });

  it("follows an animated height change on each frame and applies reduced motion in one step", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const view = mountStage();
    view.follower.sync(false);
    view.setHeight(240);
    frames[0]?.(0);
    expect(document.documentElement.scrollTop).toBe(60);
    view.setHeight(280);
    frames[1]?.(16);
    expect(document.documentElement.scrollTop).toBe(80);

    view.setHeight(200);
    view.follower.sync(true);
    expect(document.documentElement.scrollTop).toBe(40);
  });
});
