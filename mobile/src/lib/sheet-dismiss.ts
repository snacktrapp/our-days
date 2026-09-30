/**
 * Same distances as the web `use-sheet-dismiss` hook. A fast downward flick
 * also commits, which is how iOS sheets close when the drag itself is short.
 */
export const sheetDismissThresholdPx = 72;
export const sheetDismissAxisPx = 8;
/** Downward speed, in pixels per second, that closes a short drag. */
export const sheetDismissVelocity = 900;

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
    input.velocityY >= sheetDismissVelocity
  );
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
