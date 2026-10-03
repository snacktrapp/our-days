/**
 * Same distances as the web `use-sheet-dismiss` hook. A fast downward flick
 * also commits, which is how iOS sheets close when the drag itself is short.
 */
export const sheetDismissThresholdPx = 72;
export const sheetDismissAxisPx = 8;
/**
 * Downward speed, in points per second, that closes a short drag. UIKit sheets
 * close on a quick flick of the grab bar even when it only travels ~20 pt, so
 * this sits well under a full swipe (900 missed short flicks on iPhone).
 */
export const sheetDismissVelocity = 450;
/** A flick must still travel this far, so a tap with jitter never closes. */
export const sheetFlickMinPx = 14;
/** Only movement in this window before release counts toward the flick speed. */
export const sheetVelocityWindowMs = 80;
/** A finger that rests this long before lifting is not flicking. */
export const sheetFlickRestMs = 60;

export function canStartSheetDismiss(scrollTop: number, fromChrome: boolean) {
  return fromChrome || scrollTop <= 1;
}

export function sheetDismissShouldCommit(
  input: Readonly<{ dy: number; velocityY: number }>,
) {
  if (input.dy <= sheetDismissAxisPx) return false;
  if (input.velocityY <= -sheetDismissVelocity) return false;
  return (
    input.dy >= sheetDismissThresholdPx ||
    (input.dy >= sheetFlickMinPx && input.velocityY >= sheetDismissVelocity)
  );
}

type Sample = Readonly<{ y: number; t: number }>;

/**
 * Release speed (points per second, down is positive) from the touch samples
 * in the last `sheetVelocityWindowMs`. One noisy final move no longer decides
 * the flick, and a finger that paused before lifting reads as 0.
 */
export function releaseVelocity(samples: readonly Sample[], releaseT: number) {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (releaseT - last.t > sheetFlickRestMs) return 0;
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > sheetVelocityWindowMs) break;
    first = samples[i];
  }
  const elapsed = last.t - first.t;
  if (elapsed <= 0) return 0;
  return ((last.y - first.y) / elapsed) * 1000;
}

export type SheetDraft = Readonly<{
  body: string;
  title: string;
  sourceUrl: string;
  place: string;
  tags: string;
  photo: boolean;
  verse: string;
  occurredOn: string;
  occurredTime: string;
  justMe: boolean;
  circleId: string;
}>;

/** The web asks before closing a composer that differs from its defaults. */
export function sheetHasUnsavedChanges(current: SheetDraft, initial: SheetDraft) {
  return (
    current.body !== initial.body ||
    current.title !== initial.title ||
    current.sourceUrl !== initial.sourceUrl ||
    current.place !== initial.place ||
    current.tags !== initial.tags ||
    current.photo !== initial.photo ||
    current.verse !== initial.verse ||
    current.occurredOn !== initial.occurredOn ||
    current.occurredTime !== initial.occurredTime ||
    current.justMe !== initial.justMe ||
    current.circleId !== initial.circleId
  );
}

let touchingField = false;

export function setSheetTouchingField(value: boolean) {
  touchingField = value;
}

export function isSheetTouchingField() {
  return touchingField;
}
