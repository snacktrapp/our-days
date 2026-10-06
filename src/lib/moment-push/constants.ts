/** Fallback window when media never becomes ready (stall/fail). */
export const MOMENT_PUSH_FALLBACK_MS = 4 * 60 * 1000;

/** Poll interval while waiting for remaining media to finish processing. */
export const MOMENT_PUSH_POLL_MS = 15_000;

/**
 * Consecutive status/claim RPC failures that end an in-process poll.
 * One blip keeps waiting; a stuck database does not spin until the deadline.
 */
export const MOMENT_PUSH_RPC_FAILURE_LIMIT = 3;

/**
 * Moments scheduled before this instant are never swept. 2026-10-05 14:20
 * UTC is just before #207 deployed (~7:21 AM PT). The 9:49 AM PT stuck post
 * is after this floor and is sent once, if it is still inside the 24h window.
 */
export const MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO = "2026-10-05T14:20:00.000Z";

/** Ignore a backlog older than this so a sweeper outage cannot blast a day of alerts. */
export const MOMENT_PUSH_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Moments claimed per cron invocation. SQL also refuses limits above 20. */
export const MOMENT_PUSH_SWEEP_BATCH_LIMIT = 10;

export function momentPushSweepNotBefore(now: number) {
  return Math.max(
    Date.parse(MOMENT_PUSH_SWEEP_NOT_BEFORE_ISO),
    now - MOMENT_PUSH_SWEEP_MAX_AGE_MS,
  );
}
