// Retired. Fill private.photo_card_renditions from inside the deployment:
// POST /api/photos/card-backfill with an Operations session.
// There is one backfill path. This script no longer claims leases or uploads.

console.error(
  "scripts/backfill-card-renditions.mjs is retired. Use POST /api/photos/card-backfill.",
);
process.exitCode = 1;
