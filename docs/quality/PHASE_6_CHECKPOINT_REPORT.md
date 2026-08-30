# Phase 6 local Memories checkpoint

Date: 2026-08-30

Status: **local Memories slice passes in Chromium — hosted WebKit evidence and production provisioning remain pending**

This checkpoint turns the approved Memories preview into a circle-authorized, date-driven family archive while preserving the established mobile timeline design. It implements the decision-independent work that follows PD-001, PD-002, and PD-003. It creates or links no external resource and uses synthetic family data only.

## Implemented

- A connected Memories landing page with an exact, circle-time-zone **On this day** doorway and a bounded, newest-first year archive.
- Connected `/memories/on-this-day` and `/memories/years/[year]` journeys that reuse the central timeline and the existing authorized edit, trash, note, and reaction workflows.
- Truthful photo, written, and empty archive doorways. Written memories never invent a public image, and empty or future-year pages do not imply that family content exists.
- Date-only family-history semantics separated from precise event timestamps. The anniversary key remains fixed to the circle's date when a paginated journey begins, even if the browser is in another time zone or the circle crosses midnight during navigation.
- Exact leap-day behavior: February 29 memories appear on February 29, not February 28 in non-leap years.
- Stable snapshot-plus-keyset traversal for years and moments, including equal-time rows, inserts and edits during traversal, filter-bound cursors, and a 25-page cumulative-interaction ceiling.
- Explicit occurrence-domain constraints that reject infinite timestamps, BC dates, and dates outside the application-supported `0001-01-01` through `9999-12-31` range.
- Database-level active-membership checks, `SECURITY INVOKER` read functions, empty `search_path`, authenticated-only execution, row-level circle isolation, and no notes or reactions in archive-list payloads.
- A partial circle/month/day anniversary index and separate static year and anniversary query branches, avoiding a generic-plan `OR` path that could conceal the anniversary index.
- Incremental **Earlier years** navigation rather than unbounded archive loading, Unicode-safe summary truncation, bounded long names, 44px actions, reduced-motion behavior, and one-dimensional 320px/200%-zoom reflow.

## Evidence available now

- `npm run check`: formatting, ESLint, TypeScript, 37 test files, and 312 unit/contract/component tests pass.
- `npm run build:webpack`: production compilation, route generation, TypeScript, and the private-artifact scan pass.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 208 pgTAP assertions pass across five files. The 48 Memories assertions cover privileges, function posture, occurrence constraints, exact anniversaries and leap days, trash and cross-circle exclusion, dual-circle users, revocation, invalid filters and cursors, snapshot stability, equal-time pagination, a 205-year archive, and index presence.
- `npm run types:db:check`: committed Supabase types match a database rebuilt from all migrations.
- `npm run test:auth:integration`: local public-signup variants, OTP, invitation acceptance, stale-token circle denial, and both private Storage HTTP surfaces pass.
- `npm run test:db:concurrency`: overlapping organizer revocation, invitation acceptance, moment/tag edits, note edits, reversible responses, parent trash, and member revocation serialize into valid durable state. The harness now includes response bodies in reaction-race failures for actionable diagnostics.
- The connected production Chromium journey passes invitation staging and replacement OTP, invitation acceptance, Memories landing/year/anniversary browsing, stable pagination, lazy notes, reactions, thought/milestone/place creation, edit/trash/restore, 320x350 quality, cross-origin denial, two-circle account isolation, revoked access, history navigation, cleanup, and sign-out. Its browser is deliberately in `Pacific/Kiritimati` while the circle is in `America/Los_Angeles`, and its precise anniversary fixture crosses the UTC date boundary.
- The focused mobile matrix passes 35 applicable checks with one intentional project skip across iPhone-sized Chromium and 320px Chromium. It covers every Memories route, overflow, minimum touch targets, reduced motion, maximum-length timeline and portal names, fixed-navigation clearance, and 200%-equivalent reflow.
- The earlier complete detached matrix for the same checkpoint branch passes 149 checks with 55 intentional project/engine skips across Chromium mobile, Firefox mobile, 320px Chromium, and wide visual coverage. Approved Memories preview screenshots remain unchanged.
- Independent date/time, mobile UX/accessibility, and adversarial privacy/performance reviewers returned **GO** after the first-request midnight, maximum-length portal-name, query-plan, and race-condition findings were fixed and rerun.

## Anniversary query-plan evidence

A disposable 5,000-row scale fixture was loaded into the isolated local database, followed by `ANALYZE` and `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY OFF, TIMING OFF)` for an exact circle/month/day anniversary page. PostgreSQL chose:

```text
Limit (actual rows=21 loops=1)
  -> Incremental Sort
       -> Index Only Scan using moments_live_circle_anniversary_idx
            Index Cond: circle_id plus date_part(month) plus date_part(day)
            actual rows=186 loops=1
            peak sort memory=26kB
```

The scale fixture was disposable and removed by a clean database reset. The production function now has distinct static branches for year and anniversary modes, so the anniversary branch presents the same indexable predicates without a combined-mode `OR`.

## Local verification notes

- An initial attempt to run two reset-owning integration harnesses concurrently caused a local Storage 503 and schema-cache miss. They were rerun sequentially, and the complete private-Storage/auth check passed after the required Storage service was restored. This was a test-orchestration error, not a product request path; no production or family data was involved.
- Repeated sequential race testing then exposed a real timestamp defect in simultaneous reaction upserts: a waiting transaction's `statement_timestamp()` could predate the row created by the winner. The trigger now clamps `updated_at` and non-null `removed_at` at trigger execution time. The exact overlapping race and the full race suite passed twice consecutively after the fix.
- The installed macOS Playwright WebKit binary still crashes before opening an application page with `Bus error: 10`. No local WebKit result is claimed. The prepared Linux CI WebKit project remains a merge/release prerequisite.
- The default local Turbopack build cannot bind its internal CSS worker port in this restricted host. The webpack production build and artifact scan pass; the unrestricted default build remains a hosted CI/Vercel prerequisite.

## Deliberate boundaries

- Memories currently browse original authored moments; they do not add a new engagement feed, ranking, notifications, or generated content.
- Photo upload and derivative generation remain deferred until PD-006. Existing private buckets stay closed.
- Short video remains a feasibility preview pending PD-004.
- Permanent purge timing remains governed by pending PD-005. Current deletion remains reversible and clearly presented as trash/remove.
- Places remain explicit family-entered labels with no browser geolocation, map request, or third-party lookup.
- No GitHub remote, hosted Supabase, Vercel project, SMTP service, domain, worker, analytics, billing resource, or production credential was created.

## Next gate

Obtain the hosted default-build and three-engine browser result. PD-006 is the next product decision needed to begin the private original-photo and derivative pipeline; PD-004 and PD-005 can remain pending until video and irreversible purge work respectively.
