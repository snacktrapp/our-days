# Circle archiving

Organizers can archive and restore a circle. Archive removes it from the normal
Circles directory and every composer circle choice. Archived circles live in a
collapsed section of Circles. This affects everyone in that circle.

Archiving does not delete posts, memberships, invitations, or subscriptions. Existing
posts remain readable under existing permissions. Personal journals remain usable,
even if all of the user's circles are archived. New shares into an archived circle
are rejected by the database, including submissions from an already-open composer.

## Release

Apply `20260922134027_archive_circles.sql` before deploying the application; the
connected context now reads `circles.archived_at`. Do not push unrelated historical
migrations. No production circle is archived as part of the migration.

The change is additive. To roll back the feature, restore archived circles first
and then roll back the application; keep the column and function. Never delete
circle data to roll back this feature.

## Checks

- Database: organizer archive/restore, outsider denial, preserved history and
  membership, blocked stale shares, private journal writes, restored shared writes.
- Server action: same-origin, role check, failure/preview honesty, revalidation.
- UI/data: collapsed restore list, archived circles excluded from posting options,
  unchanged identity, compact mobile confirmation.
