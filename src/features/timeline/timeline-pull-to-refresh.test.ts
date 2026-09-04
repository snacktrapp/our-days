import { afterEach, describe, expect, it } from "vitest";
import { backgroundScrollLockClass } from "@/features/dialog/lock-background-scroll";
import {
  feedIsAtTop,
  journalRefreshBlocked,
  pullArmPx,
  pullMaxPx,
  pullShouldRefresh,
  pullIsVertical,
  pullThresholdPx,
  readFeedScroll,
  readJournalRefreshBlock,
  resistedPull,
} from "./timeline-pull-to-refresh";

describe("timeline pull-to-refresh math", () => {
  it("resists farther pulls and never exceeds the visual cap", () => {
    expect(resistedPull(-12)).toBe(0);
    expect(resistedPull(0)).toBe(0);
    expect(resistedPull(32)).toBeGreaterThan(20);
    expect(resistedPull(32)).toBeLessThan(32);
    expect(resistedPull(240)).toBe(pullMaxPx);
    expect(resistedPull(64)).toBeLessThan(resistedPull(120));
  });

  it("only arms a downward vertical pull", () => {
    expect(pullIsVertical(0, pullArmPx)).toBe(true);
    expect(pullIsVertical(4, 40)).toBe(true);
    expect(pullIsVertical(40, 12)).toBe(false);
    expect(pullIsVertical(0, 8)).toBe(false);
    expect(pullIsVertical(0, -40)).toBe(false);
  });

  it("refreshes only after a deliberate pull", () => {
    expect(pullShouldRefresh(pullThresholdPx - 1)).toBe(false);
    expect(pullShouldRefresh(pullThresholdPx)).toBe(true);
  });

  it("treats the window and family stage as one feed top", () => {
    expect(feedIsAtTop(0, 0)).toBe(true);
    expect(feedIsAtTop(1, 0)).toBe(true);
    expect(feedIsAtTop(0, 1)).toBe(true);
    expect(feedIsAtTop(2, 0)).toBe(false);
    expect(feedIsAtTop(0, 8)).toBe(false);
  });

  it("blocks composer lock, overlays, and nested scrollers", () => {
    expect(
      journalRefreshBlocked({
        composerLocked: true,
        overlayOpen: false,
        dialogOpen: false,
        nestedScrollTop: null,
      }),
    ).toBe(true);
    expect(
      journalRefreshBlocked({
        composerLocked: false,
        overlayOpen: true,
        dialogOpen: false,
        nestedScrollTop: null,
      }),
    ).toBe(true);
    expect(
      journalRefreshBlocked({
        composerLocked: false,
        overlayOpen: false,
        dialogOpen: true,
        nestedScrollTop: null,
      }),
    ).toBe(true);
    expect(
      journalRefreshBlocked({
        composerLocked: false,
        overlayOpen: false,
        dialogOpen: false,
        nestedScrollTop: 24,
      }),
    ).toBe(true);
    expect(
      journalRefreshBlocked({
        composerLocked: false,
        overlayOpen: false,
        dialogOpen: false,
        nestedScrollTop: 0,
      }),
    ).toBe(false);
  });
});

describe("timeline pull-to-refresh page state", () => {
  afterEach(() => {
    document.documentElement.className = "";
    document.body.className = "";
    document.body.replaceChildren();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
  });

  it("reads the window and phone-stage scroll positions together", () => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 12,
    });
    const stage = document.createElement("div");
    stage.className = "phone-stage";
    Object.defineProperty(stage, "scrollTop", {
      configurable: true,
      value: 4,
    });
    document.body.append(stage);

    expect(readFeedScroll()).toEqual({
      windowScrollY: 12,
      stageScrollTop: 4,
    });
  });

  it("blocks a pull while the composer or photo overlay owns the page", () => {
    const card = document.createElement("article");
    document.body.append(card);
    expect(readJournalRefreshBlock(card)).toBe(false);

    document.body.classList.add(backgroundScrollLockClass);
    expect(readJournalRefreshBlock(card)).toBe(true);
    document.body.classList.remove(backgroundScrollLockClass);

    document.documentElement.classList.add("overlay-open");
    expect(readJournalRefreshBlock(card)).toBe(true);
  });

  it("lets the page pull when a thought box is already at its top", () => {
    const verse = document.createElement("div");
    verse.style.overflowY = "auto";
    Object.defineProperty(verse, "clientHeight", { value: 80 });
    Object.defineProperty(verse, "scrollHeight", { value: 240 });
    Object.defineProperty(verse, "scrollTop", {
      configurable: true,
      writable: true,
      value: 40,
    });
    const copy = document.createElement("p");
    verse.append(copy);
    document.body.append(verse);

    expect(readJournalRefreshBlock(copy)).toBe(true);
    verse.scrollTop = 0;
    expect(readJournalRefreshBlock(copy)).toBe(false);
  });
});
