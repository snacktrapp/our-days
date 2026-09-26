import "server-only";

import { cache } from "react";

/**
 * Lab-only stand-in for phone-to-Supabase latency. Unset in production.
 * One wait per request, shared by the chrome and the opening timeline.
 */
export const labJournalDataDelay = cache(async () => {
  const raw = process.env.OUR_DAYS_LAB_JOURNAL_DELAY_MS;
  if (!raw) return;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
});

export function labBlocksShellOnJournalData() {
  return process.env.OUR_DAYS_LAB_BLOCK_BEFORE_SHELL === "1";
}
