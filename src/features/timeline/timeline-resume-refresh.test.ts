import { describe, expect, it } from "vitest";
import {
  resumeRefreshMaximumAgeMs,
  resumeRefreshMinimumHiddenMs,
  shouldResumeRefreshOnPageShow,
  shouldResumeRefreshOnVisibility,
} from "./timeline-resume-refresh";

describe("timeline resume refresh", () => {
  it("refreshes after a hidden-to-visible transition only when stale enough", () => {
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: true,
        isHidden: false,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: 0,
      }),
    ).toBe(true);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: true,
        isHidden: false,
        hiddenForMs: 500,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(true);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: true,
        isHidden: false,
        hiddenForMs: 500,
        lastRefreshAgeMs: 500,
      }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: false,
        isHidden: false,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: true,
        isHidden: true,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: false,
        isHidden: true,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
  });

  it("ignores the first visibility reading before any transition", () => {
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: null,
        isHidden: false,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({
        wasHidden: null,
        isHidden: true,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
  });

  it("refreshes bfcache restores only when stale enough", () => {
    expect(
      shouldResumeRefreshOnPageShow({
        persisted: true,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: 0,
      }),
    ).toBe(true);
    expect(
      shouldResumeRefreshOnPageShow({
        persisted: true,
        hiddenForMs: 500,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(true);
    expect(
      shouldResumeRefreshOnPageShow({
        persisted: true,
        hiddenForMs: 500,
        lastRefreshAgeMs: 500,
      }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnPageShow({
        persisted: false,
        hiddenForMs: resumeRefreshMinimumHiddenMs,
        lastRefreshAgeMs: resumeRefreshMaximumAgeMs,
      }),
    ).toBe(false);
  });
});
