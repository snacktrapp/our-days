import { overlayScrollParent } from "@/features/dialog/lock-background-scroll";

export const pullArmPx = 10;
export const pullThresholdPx = 64;
export const pullMaxPx = 80;
export const pullRefreshHoldMs = 280;
export const pullSettleMs = 220;

export type TimelinePullState =
  "idle" | "pulling" | "armed" | "refreshing" | "settling";

export function resistedPull(rawPx: number) {
  if (rawPx <= 0) return 0;
  return Math.min(pullMaxPx, rawPx / (1 + rawPx / 160));
}

export function pullIsVertical(dx: number, dy: number) {
  return dy >= pullArmPx && dy > Math.abs(dx) * 1.2;
}

export function pullShouldRefresh(rawPx: number) {
  return rawPx >= pullThresholdPx;
}

export function feedIsAtTop(windowScrollY: number, stageScrollTop: number) {
  return windowScrollY <= 1 && stageScrollTop <= 1;
}

export function journalRefreshBlocked(input: {
  composerLocked: boolean;
  overlayOpen: boolean;
  dialogOpen: boolean;
  nestedScrollTop: number | null;
}) {
  if (input.composerLocked || input.overlayOpen || input.dialogOpen) {
    return true;
  }
  return input.nestedScrollTop != null && input.nestedScrollTop > 1;
}

export function readFeedScroll() {
  const stage = document.querySelector(".phone-stage");
  return {
    windowScrollY: window.scrollY || document.documentElement.scrollTop || 0,
    stageScrollTop: stage instanceof HTMLElement ? stage.scrollTop : 0,
  };
}

function pageScroller(scroller: HTMLElement) {
  return (
    scroller === document.documentElement ||
    scroller === document.body ||
    scroller.classList.contains("phone-stage")
  );
}

export function readJournalRefreshBlock(target: EventTarget | null) {
  const html = document.documentElement;
  const body = document.body;
  const composerLocked =
    html.classList.contains("composer-scroll-locked") ||
    body.classList.contains("composer-scroll-locked");
  const overlayOpen =
    html.classList.contains("overlay-open") ||
    body.classList.contains("overlay-open");
  const dialogOpen = Boolean(
    document.querySelector(
      "dialog[open], .photo-lightbox, .fullscreen-media-dialog[open]",
    ),
  );
  const scroller = overlayScrollParent(target);
  const nestedScrollTop =
    scroller && !pageScroller(scroller) ? scroller.scrollTop : null;

  return journalRefreshBlocked({
    composerLocked,
    overlayOpen,
    dialogOpen,
    nestedScrollTop,
  });
}

export function announceTimelineRefresh() {
  const region = document.getElementById("journal-live-region");
  if (region) region.textContent = "Checking for newer days.";
}
