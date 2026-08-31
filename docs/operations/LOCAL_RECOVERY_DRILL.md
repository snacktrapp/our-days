# Local logical recovery drill

This runbook covers one deliberately narrow recovery check: a synthetic logical database dump is restored into a temporary database in the same local Supabase Postgres container, then compared with its source. It is useful regression evidence for schema and row fidelity. It is **not** a production disaster-recovery procedure.

## Safety boundary

- Run only against the unlinked local Supabase project whose project ID is `our-days` and database container is `supabase_db_our-days`.
- The command never resets or writes to the canonical source database. It fails closed unless that source already matches the exact reviewed synthetic fixture and its seed and migrations are committed and unchanged. Never run it against a linked project, hosted database, production resource, or database containing real family data.
- The expected schema head is `20260831020000_phase_4a_photo_intake_foundation.sql`. A different head fails closed until this runbook and the drill are reviewed together.
- The drill requires Node.js 22 or newer, Docker, and the local Supabase stack. Do not run it concurrently with a reset-owning database or browser harness.
- The local seed must remain synthetic: Auth addresses end in `@example.test`, only the canonical test-circle identities are present, and `storage.objects` is empty. A failed synthetic-data preflight stops before the dump.

## Run

From the repository root:

```bash
npm run supabase:start
npm run db:reset
npm run test:db:restore:self
npm run test:db:restore
```

`db:reset` is the explicit, destructive fixture-preparation step. Inspect or export any local work before running it. The pure `test:db:restore:self` check requires no database and proves rejection seams for an unexpected schema, an unexpected fourth bucket, unsupported database metadata, unsafe diagnostic identities, fixed database grant/setting allowlists, encoded apostrophe/backslash handling, unsafe-setting rejection, cleanup retry/flag retention, and graceful/TERM/SIGKILL/resistant snapshot-exporter lifecycles. `test:db:restore` then takes an exclusive local lock, verifies the exact canonical synthetic source without mutating it, and holds one exported serializable/read-only/deferrable snapshot across every source preflight, fingerprint, the in-memory database-settings sidecar, and the full logical dump. It validates the snapshot identifier, exporter backend PID, and unique exporter application name without logging them. It verifies that the custom archive can be listed, restores it into a randomly named temporary database created from `template0`, applies the two exact reconciliation overlays described below, and compares source and restored invariants. Cleanup retries and verifies the exact temporary database, dump, and lock removals. Exporter cleanup first requests rollback/quit, then uses bounded TERM and KILL escalation. After local-client exit it polls for the exact validated backend identity, terminates that backend through a separate connection if needed, and proves absence before clearing the child reference. A normal close must be graceful; during failure or signal cleanup, a forced but confirmed exit and backend absence preserve the original failure category, while unproved backend absence overrides it as `cleanup`.

The source must contain exactly the reviewed local non-system schema inventory: `_realtime`, `auth`, `extensions`, `graphql`, `graphql_public`, `pgbouncer`, `private`, `public`, `realtime`, `storage`, `supabase_functions`, `supabase_migrations`, and `vault`. Committed fingerprints independently pin the canonical schema-only archive, the exhaustive normalized rows for every base/partitioned/materialized table in those schemas, database/event-trigger/publication/large-object metadata, the semantic catalog, and the complete custom-archive inventory. Only an explicit table/column allowlist of synthetic fixture timestamps is normalized to null/present state; this includes reset-generated `storage.migrations.executed_at` and `supabase_functions.migrations.inserted_at`, while migration IDs, names, hashes, versions, stable application fields, and meaningful occurrence dates remain exact. Storage has an independent total-count guard and must contain exactly three private buckets with the reviewed attributes: closed originals, closed display derivatives, and quarantine-only intake.

Source-to-restored comparison covers every reviewed schema and data table, plus relations, columns, constraints, indexes, policies, routines, triggers, supported types, default privileges, extensions, sequence state, object owners, and effective non-owner ACL capabilities. For schemas, columns, routines, and types, the semantic catalog deliberately represents both `NULL` ACLs and explicit owner-only ACLs as an empty non-owner grant set; the owner is pinned separately, and committed source/restored schema fingerprints pin the full pg_dump-visible raw forms. Raw ACL provenance retains the previously reviewed application/Auth/Storage/migration boundary. PostgreSQL also normalizes explicit owner-only ACL rows to `NULL` on eight reviewed private relations/sequences during this same-cluster restore; owners retain those privileges implicitly. The drill enforces that exact eight-object representation exception separately while preserving every non-owner privilege tuple, and fails on any other reviewed raw-ACL drift. A successful run means these checked invariants matched within this one local Postgres cluster; the safety inventory and fingerprints must be deliberately reviewed when migrations or the local platform image changes.

## Archive reconciliation boundary

The custom pg_dump archive is necessary but not sufficient on its own for this `template0` rehearsal:

- PostgreSQL records the initial ACLs of `graphql` and `graphql_public` in `pg_init_privs`. Because their live ACLs equal that extension baseline, pg_dump omits those grants. A blank target has neither the baseline rows nor the effective non-owner grants. The drill first proves the exact source baseline and effective ACL, then proves the target is in the one reviewed empty state, and applies only the confirmed missing `USAGE` grants (including the postgres grant option) as `supabase_admin`. It never writes `pg_init_privs`.
- Database-object ACLs and database-role settings are not applied by this direct-into-a-precreated-database restore path. Under the same exported source snapshot, the drill verifies an exact role/parameter allowlist and committed sidecar fingerprint, keeps the two local Auth setting values only in memory, proves the target database has `datacl IS NULL` and zero database-role settings, then transactionally applies the exact platform-role grants and two settings. Setting values are base64-encoded before entering SQL and loaded through fixed `set_config` names plus `ALTER DATABASE ... SET ... FROM CURRENT`; values and SQL diagnostics are never printed.
- Database comments and database security labels are likewise not applied by this restore path because it deliberately does not use `pg_restore --create`. The custom archive may carry database properties, so this version fails before dumping unless the source database comment is null and no `pg_shseclabel` row exists for the source database, then enforces the same invariant on the target. Supporting either state requires a separately reviewed, authenticated sidecar format or a reviewed `--create` recovery path rather than silently omitting it.

These overlays are part of the tested local restore contract. The current in-memory sidecar is not a backup artifact and provides no disaster-recovery evidence: after source loss it would no longer exist. A production backup must create a versioned, authenticated, encrypted sidecar at backup time, bind it cryptographically to the exact archive digest, retain it independently under reviewed key custody, and verify both artifacts before any restore. Production recovery cannot depend on querying the lost source.

## Logging contract

Console output is values-free. It may identify a passed stage or the name of a failed invariant, but must not print database rows, family content, email addresses, IDs, dump contents, SQL results, checksums, digest prefixes, tokens, credentials, or connection strings. Investigate a failure by adding a narrowly scoped local assertion; do not turn on broad data logging.

## What this does not prove

- Supabase Storage object bytes are not contained in the database dump. An empty local `storage.objects` catalog does not exercise recovery of quarantine, original, or derivative bytes.
- Restoring into another database in the same container does not prove a new Supabase project can be rebuilt. Cluster roles, Auth configuration and signing material, API keys, Storage configuration, Edge Functions, Realtime settings, provider configuration, Vercel configuration, and other hosted control-plane state remain outside this drill.
- The drill does not create an off-site backup, encrypt an artifact, test a hosted restore, exercise point-in-time recovery, or establish an RPO or RTO.
- Canonical `auth.sessions`, refresh-token, and one-time-token tables are empty, so this drill does not exercise session recovery. It does not revoke sessions, rotate credentials, suppress previously deleted identities/content after an older backup is restored, or prove account-closure recovery semantics.
- It does not test media originals, derivatives, export artifacts, worker state outside Postgres, or third-party delivery/provider records.

## Production recovery gate

Before personal family data is accepted, perform a separate, reviewed recovery rehearsal into a newly provisioned, quarantined Supabase project at the current migration head. Keep that project unreachable by family clients and outbound providers until every check passes. The rehearsal must include:

1. Restore the database into the quarantined project and reconcile the authoritative migration head, schema, tenant boundaries, RLS/FORCE RLS, policies, grants, routines, data counts, and content-safe digests.
   Review raw ACL representation and grantor provenance in that new cluster; the local eight-object exception is not a portable production assumption.
2. Invalidate recovered sessions and refresh credentials before exposure; rotate recovered Auth JWT/signing settings, service credentials, API keys, database credentials, worker secrets, provider credentials, and any recovery-time credentials according to the platform-supported procedure. Restored local Auth settings are fidelity evidence, never activation approval.
3. Reapply an external, append-only suppression ledger so account closures, permanent deletions, revoked invitations, invalidated exports/downloads, and other non-resurrection decisions made after the backup cannot silently return.
4. Restore original and derived media from a separate authenticated, encrypted backup. Reconcile every expected object and its full-byte SHA-256 against authoritative metadata; reject missing, extra, mismatched, cross-circle, or unexpectedly public objects.
5. Recreate and verify hosted configuration that the logical dump cannot carry, including private Storage buckets and policies, Auth/provider settings, URLs, Functions/workers, scheduled work, email suppression, environment separation, and no-content observability.
6. Run denial suites from anonymous, revoked, no-circle, wrong-circle, and dual-circle actors before any client or provider can reach the project.
7. Measure and approve an evidence-backed production RPO and RTO, record backup retention and encryption/key-custody policy, and prove restoration from the actual off-site artifact—not a same-cluster copy.

Until every production gate is complete, this command remains a local regression test only and Phase 8 remains incomplete.
