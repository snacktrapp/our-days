import { MOMENT_PUSH_FALLBACK_MS, momentPushSweepNotBefore } from "./constants";

export type MomentPushSweepCandidate = Readonly<{
  scheduledAt: number | null;
  notifiedAt: number | null;
  mediaReady: boolean;
  trashed: boolean;
  kind: string;
  audience: string;
}>;

/**
 * Same due rule as `public.sweep_due_moment_pushes`: scheduled, not yet
 * notified, family, not trashed, not an insight, at or after the sweep
 * floor (deploy cutoff or 24 hours, whichever is later), and either every
 * photo/video is ready or the four-minute fallback has elapsed.
 */
export function momentIsDueForPushSweep(
  moment: MomentPushSweepCandidate,
  now: number,
) {
  if (moment.scheduledAt === null || moment.notifiedAt !== null) return false;
  if (moment.trashed || moment.kind === "insight") return false;
  if (moment.audience !== "family") return false;
  if (moment.scheduledAt < momentPushSweepNotBefore(now)) return false;
  const fallbackElapsed = now >= moment.scheduledAt + MOMENT_PUSH_FALLBACK_MS;
  return moment.mediaReady || fallbackElapsed;
}
