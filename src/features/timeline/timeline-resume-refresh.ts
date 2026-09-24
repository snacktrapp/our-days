export const resumeRefreshDebounceMs = 1_200;
export const resumeRefreshMinimumHiddenMs = 60_000;
export const resumeRefreshMaximumAgeMs = 60_000;
export const timelineResumeRefreshStartingEvent =
  "our-days:timeline-resume-refresh-starting";

type ResumeThresholdInput = Readonly<{
  hiddenForMs: number | null;
  lastRefreshAgeMs: number | null;
  minimumHiddenMs?: number;
  maximumAgeMs?: number;
}>;

function shouldResumeRefreshAfterAbsence(input: ResumeThresholdInput) {
  const minimumHiddenMs = input.minimumHiddenMs ?? resumeRefreshMinimumHiddenMs;
  const maximumAgeMs = input.maximumAgeMs ?? resumeRefreshMaximumAgeMs;
  const hiddenLongEnough =
    input.hiddenForMs != null && input.hiddenForMs >= minimumHiddenMs;
  const refreshIsStale =
    input.lastRefreshAgeMs != null && input.lastRefreshAgeMs >= maximumAgeMs;
  return hiddenLongEnough || refreshIsStale;
}

export function shouldResumeRefreshOnVisibility(input: {
  wasHidden: boolean | null;
  isHidden: boolean;
  hiddenForMs: number | null;
  lastRefreshAgeMs: number | null;
  minimumHiddenMs?: number;
  maximumAgeMs?: number;
}) {
  if (!(input.wasHidden === true && input.isHidden === false)) return false;
  return shouldResumeRefreshAfterAbsence(input);
}

export function shouldResumeRefreshOnPageShow(input: {
  persisted: boolean;
  hiddenForMs?: number | null;
  lastRefreshAgeMs: number | null;
  minimumHiddenMs?: number;
  maximumAgeMs?: number;
}) {
  if (input.persisted !== true) return false;
  return shouldResumeRefreshAfterAbsence({
    hiddenForMs: input.hiddenForMs ?? null,
    lastRefreshAgeMs: input.lastRefreshAgeMs,
    minimumHiddenMs: input.minimumHiddenMs,
    maximumAgeMs: input.maximumAgeMs,
  });
}
