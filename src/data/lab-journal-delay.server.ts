import "server-only";

import { cache } from "react";

/**
 * The lab script opts in with OUR_DAYS_LAB=1. Real production never waits,
 * even if a delay variable is present in the environment.
 */
export function labControlsEnabled() {
  if (process.env.VERCEL_ENV === "production") return false;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.OUR_DAYS_LAB !== "1"
  ) {
    return false;
  }
  return true;
}

const waitForLabJournalData = cache(async () => {
  const raw = process.env.OUR_DAYS_LAB_JOURNAL_DELAY_MS;
  if (!raw) return;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
});

/** One wait per request, shared by the chrome and the opening timeline. */
export async function labJournalDataDelay() {
  if (!labControlsEnabled()) return;
  await waitForLabJournalData();
}

export function labBlocksShellOnJournalData() {
  if (!labControlsEnabled()) return false;
  return process.env.OUR_DAYS_LAB_BLOCK_BEFORE_SHELL === "1";
}
