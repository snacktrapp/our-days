import { describe, expect, it } from "vitest";
import {
  canStartSheetDismiss,
  sheetDismissShouldCommit,
  sheetDismissThresholdPx,
} from "./use-sheet-dismiss";

describe("sheet dismiss", () => {
  it("starts from the handle even when the list is scrolled", () => {
    expect(canStartSheetDismiss(180, true)).toBe(true);
    expect(canStartSheetDismiss(180, false)).toBe(false);
  });

  it("starts from a list that is scrolled to the top", () => {
    expect(canStartSheetDismiss(0, false)).toBe(true);
  });

  it("commits only after a clear downward drag", () => {
    expect(sheetDismissShouldCommit(sheetDismissThresholdPx - 1)).toBe(false);
    expect(sheetDismissShouldCommit(sheetDismissThresholdPx)).toBe(true);
  });
});
