import { describe, expect, it } from "vitest";
import {
  shouldResumeRefreshOnPageShow,
  shouldResumeRefreshOnVisibility,
} from "./timeline-resume-refresh";

describe("timeline resume refresh", () => {
  it("refreshes only on a hidden-to-visible transition", () => {
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: true, isHidden: false }),
    ).toBe(true);
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: false, isHidden: false }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: true, isHidden: true }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: false, isHidden: true }),
    ).toBe(false);
  });

  it("ignores the first visibility reading before any transition", () => {
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: null, isHidden: false }),
    ).toBe(false);
    expect(
      shouldResumeRefreshOnVisibility({ wasHidden: null, isHidden: true }),
    ).toBe(false);
  });

  it("refreshes bfcache restores and ignores ordinary pageshow", () => {
    expect(shouldResumeRefreshOnPageShow({ persisted: true })).toBe(true);
    expect(shouldResumeRefreshOnPageShow({ persisted: false })).toBe(false);
  });
});
