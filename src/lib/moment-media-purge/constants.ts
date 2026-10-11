/** Moments considered per cron invocation. SQL also refuses limits above 8. */
export const MOMENT_MEDIA_PURGE_MOMENT_LIMIT = 8;

/** Storage API remove() calls stay small so one failure does not span a bucket. */
export const MOMENT_MEDIA_PURGE_REMOVE_BATCH = 8;

export const MOMENT_MEDIA_BUCKETS = [
  "our-days-originals",
  "our-days-display",
  "our-days-videos",
] as const;

export type MomentMediaBucket = (typeof MOMENT_MEDIA_BUCKETS)[number];
