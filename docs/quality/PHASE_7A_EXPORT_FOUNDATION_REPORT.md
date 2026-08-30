# Phase 7A export foundation checkpoint

Date: 2026-08-30

Status: **local request ledger and unconnected archive contract pass — Phase 7 production entry remains pending**

This checkpoint establishes decision-independent ownership groundwork without claiming that family exports are available. It creates no external resource, uses synthetic data only, exposes no export button or download route, and does not connect a worker, Storage artifact, service credential, media source, retention duration, or purge behavior.

## Implemented

- A private `export_jobs` request ledger outside the Data API schema, with FORCE RLS, no browser table grants, same-circle composite attribution, immutable request identity, and content-free request/invalidation audit events.
- A narrow organizer-only request RPC. The database derives the authenticated membership after taking the shared circle lock; callers cannot provide requester identity.
- Lost-response idempotency and bounded intent: retries return the same job, and distinct keys coalesce while one request remains queued for that circle/requester.
- An authorization version captured from the requester membership. Demotion and revocation terminally invalidate queued work under the same circle lock. Restoring organizer access cannot resurrect an older job.
- A deterministic version-1 structured-data archive contract containing exactly canonical `manifest.json` and `data/family-records.json` files.
- Manifest inventory, counts, lifecycle inventory, checksums, immutable snapshot digest, strict paths, exhaustive runtime validation, and relational same-circle checks. Family content appears only in the records file, not a duplicate manifest payload.
- Membership-scoped attribution without Supabase Auth user IDs. Recursive validation rejects Auth-user, email, session, and token fields.
- Explicit zero-media scope. Photo originals and video are not modeled by this version while PD-006 and PD-004 remain pending.
- A pure recovery harness whose caller supplies only an opaque export ID. Its coordinator contract requires a durable job load, a fresh authorization check before existing-result disclosure, and an atomic authorization/version/snapshot/full-result compare-and-set before publication.
- Partial missing files resume; conflicting bytes, changed source snapshots, extra paths, cross-circle records, revocation before publication, and revocation during existing-archive validation fail closed. Canonical sorting is ordinal rather than locale-dependent.
- Family Settings promotion copy remains truthful: organizers will manage exports only after private archive delivery is connected.

## Evidence available now

- `npm run test:db`: 307 pgTAP assertions pass across eight files. Coverage includes exact RPC/ACL catalogs, active/revoked/no-circle/wrong-circle/dual-circle denial, cross-circle composite integrity, idempotency, bounded queued work, immutable jobs, authorization-version invalidation, demotion/revocation, and no resurrection after access restoration.
- `npm run test:db:concurrency`: overlapping duplicate requests converge on one durable request/audit; export-versus-demotion ends with either no job or one terminally invalidated job, never eligible work.
- Focused archive verification: 34 archive/recovery tests pass, including omission and forbidden-identifier canaries, canonical decoding/checksums, zero media, every ready-result field, partial failure boundaries, concurrent convergence, and both pre-publication and existing-ready revocation races.
- Full Vitest suite, TypeScript, ESLint, Prettier, generated Supabase type comparison, and Supabase schema lint pass locally.
- `npm run build:webpack` passes production compilation, route generation, TypeScript, and the complete private-artifact scan. The default Turbopack build remains an external CI/Vercel gate because this managed environment denies the internal CSS worker's local port binding, including on an approved retry.
- Two independent adversarial passes found request flooding, authorization resurrection, manifest duplication, Auth-ID exposure, snapshot/ready races, weak runtime validation, premature media/lifecycle policy, exact-ACL gaps, and locale-sensitive hashing. Those findings were remediated and re-reviewed; the final existing-ready revocation race was then fixed with an immediate post-validation authorization check and regression test.

## Deliberate boundaries

- This is not a production export implementation. The durable snapshot/ready schema, privileged source adapter, separately deployed worker, private artifact store, packaging/download delivery, worker credential boundary, and fresh delivery-time authorization do not exist yet.
- The pure source-selection contract cannot prove database completeness by itself. Production must materialize and bind the allowlisted circle snapshot transactionally, then integration-test omitted-row and concurrent-mutation cases against independent authoritative counts/digests.
- Private partial files have no cleanup/quarantine policy yet. That belongs with the worker and must not silently choose PD-005 retention.
- Version 1 exports structured records only. Originals require the approved PD-006 media schema and checksum authority; video additionally requires PD-004.
- Trash/history inclusion is described as source-selected with retention policy `unspecified`. It does not accept the proposed 30-day policy or implement hard purge; PD-005 remains the Phase 7 entry prerequisite.
- There is no user-facing request/status/download surface, so browser, WebKit, hosted, and real-iPhone export evidence is not claimed by this checkpoint.

## Next gate

Keep Phase 7 incomplete. After PD-005 is accepted—and after PD-006 for originals—add the durable snapshot and atomic ready-state RPCs, a separately permissioned worker/source adapter, private artifact storage, retry/quarantine behavior, delivery-time membership checks, safe packaging and download, and database-to-artifact completeness tests. Only then expose an organizer export action.
