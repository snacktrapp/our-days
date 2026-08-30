# Phase 8A local recovery foundation checkpoint

Date: 2026-08-30

Status: **same-container synthetic logical database fidelity passes locally — production disaster recovery remains unproven**

This checkpoint adds a destructive-to-local-fixtures, fail-closed recovery regression test. It does not create or validate a production backup, hosted restore, media recovery path, off-site copy, retention policy, session-revocation procedure, suppression ledger, RPO, or RTO.

## Implemented

- `npm run test:db:restore` targets only the exact unlinked local Supabase project/container and takes an exclusive lock so it cannot overlap another recovery drill.
- It never resets or writes to the canonical source database. An operator prepares fixtures explicitly with `npm run db:reset`; the drill then fails closed unless seed and migration inputs are committed and unchanged and the database exactly matches the reviewed synthetic identities, content, empty Auth credential/session state, exactly two private buckets with reviewed attributes, the exact 13-schema local inventory, committed schema/catalog/data/metadata fingerprints, and migration head `20260831000000_phase_7b_membership_attribution_foundation.sql`.
- A custom-format logical dump is created inside the local Postgres container, list-checked, and restored transactionally into a randomly named temporary database created from `template0`.
- One exported serializable/read-only/deferrable source snapshot is validated and reused by every source preflight/fingerprint query and the full pg_dump, closing the preflight-to-dump race.
- Source and restored manifests exhaustively compare base/partitioned/materialized tables and normalized durable rows across all 13 reviewed local schemas, plus checked catalog structure, migration history, RLS/policies, object owners and effective ACL capabilities, routines, triggers, extensions, sequence state, database settings, event triggers, publications, and large objects. A normalized pg_restore archive inventory independently rejects unexpected dumped object classes or table-data entries.
- The drill proves and repairs two exact boundaries before comparison: the omitted `pg_init_privs`-baseline grants for `graphql`/`graphql_public`, and database ACL/settings state that this direct-into-a-precreated-database restore path does not apply. Both paths require exact source and empty-target preconditions, fixed role/setting allowlists, committed fingerprints, transactional application, and full post-repair semantic equality. The extension overlay never edits `pg_init_privs`; the database setting values remain memory-only, encoded before SQL, and absent from output.
- Database comments and shared database security labels are deliberately unsupported and fail closed: the source must have no database comment and no `pg_shseclabel` entry for the current database before dump creation, and the restored target must satisfy the same invariant. The current evidence therefore does not claim preservation of arbitrary database comment or security-label text.
- Temporary database and dump names are generated and strictly validated before cleanup. Cleanup retries and verifies each exact removal, retains live-resource flags on failure, and overrides success if any resource cannot be removed; signal handlers apply the same rule. Snapshot-exporter cleanup validates an unlogged backend PID and unique application name, requests rollback/quit, and escalates through bounded TERM and SIGKILL. After client exit it polls for the exact backend identity, terminates that backend through a separate connection if necessary, and proves absence before clearing the child reference. A normal close must be graceful; failure/signal cleanup preserves an earlier failure after forced-but-confirmed absence and uses the `cleanup` override only when absence remains unproved.
- A database-free static self-test proves the third-bucket, unexpected-schema, unsupported-database-metadata, redaction, database-repair allowlist/encoding, cleanup-failure, exporter race/concurrency, and graceful/TERM/SIGKILL/fully-resistant lifecycle seams.
- Console output is deliberately values-free: only stage success or failed-invariant names may be emitted. Rows, addresses, IDs, content, digests, tokens, credentials, SQL result values, and connection strings are excluded.

## Evidence available now

- After explicit fixture preparation, the drill proves that the read-only canonical synthetic source has a readable dump, restores into a separate database in the same local Postgres container, and rejects any checked source/target manifest mismatch.
- The restored database is compared independently rather than inferred from a successful `pg_restore` exit code.
- Object owners and effective ACL capabilities match, and the restore does not use owner/grant omission flags. The all-schema semantic catalog compares only non-owner grant sets for schemas, columns, routines, and types, treating `NULL` and explicit owner-only ACL storage as equivalent while pinning owners separately. Independent committed source/restored schema fingerprints still pin the complete pg_dump-visible raw form. In the narrower raw-provenance check, PostgreSQL normalizes the exact reviewed explicit, non-grantable owner-only ACL tuples on five private relations/sequences to `NULL`; those owner capabilities remain implicit. The harness enforces that five-object allowlist separately, preserves every non-owner tuple, and rejects any missing or additional reviewed raw-ACL drift. Raw ACL representation is therefore not identical and must be reviewed again in a newly provisioned production-recovery cluster.
- Synthetic-data and local-identity guards run before backup creation, and temporary artifacts are cleaned without printing sensitive values.
- The operational procedure and its stop conditions are recorded in `docs/operations/LOCAL_RECOVERY_DRILL.md`.

## Deliberate boundaries

- This is a same-container database fidelity drill. It cannot prove restoration into a newly provisioned Supabase project, recovery after a region/project loss, or recreation of hosted control-plane configuration and cluster-global roles.
- A Supabase database dump contains Storage metadata, not the stored object bytes. The current synthetic source requires zero `storage.objects`, so media-byte recovery is completely outside this evidence.
- No authenticated, encrypted, off-site database or media backup exists. No retention, key-custody, restore authorization, tamper detection, RPO, or RTO has been chosen or measured.
- The local database-settings sidecar exists only in process memory while the source snapshot is live. It is not durable recovery evidence. A production sidecar must be versioned, authenticated, encrypted, captured at backup time, and cryptographically bound to the exact archive digest so recovery never depends on the lost source.
- Canonical Auth session, refresh-token, and one-time-token tables are empty. Session recovery is therefore not exercised at all; the drill performs no session invalidation or credential rotation and must not be used to expose a recovered production project.
- There is no external append-only suppression ledger. Restoring an older backup could therefore resurrect an account binding, invitation, export/download, or content that should remain suppressed after deletion or revocation.
- Export artifacts, media derivatives/originals, provider state, worker state outside Postgres, Functions, Realtime, Auth/provider settings, API keys, secrets, environment variables, and Vercel resources are not recovered.
- This checkpoint does not satisfy the release-blocking acceptance criterion for documented database **and media** recovery, and it does not complete Phase 8.

## Production gate

Keep production recovery and external release unavailable. The next recovery milestone must restore a real encrypted off-site database artifact and its versioned/authenticated/encrypted, archive-bound reconciliation sidecar into a newly created, quarantined Supabase project at the current migration head; invalidate all restored sessions and rotate recovered JWT/signing settings and every credential before exposure; reapply an external append-only suppression ledger; and restore media from a separate authenticated, encrypted backup with per-object full-byte SHA-256 reconciliation. It must then recreate hosted configuration, run the complete authorization-denial suite, and establish measured, approved RPO/RTO evidence before personal family data is accepted.
