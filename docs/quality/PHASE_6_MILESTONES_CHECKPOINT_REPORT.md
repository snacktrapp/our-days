# Phase 6 connected Milestones checkpoint

Date: 2026-08-30

Status: **local connected slice passes in Chromium and Firefox — hosted WebKit and production provisioning remain pending**

This checkpoint adds the smallest coherent milestone archive to the established Memories experience. It creates no external resource, uses only synthetic local data, and does not change the accepted year or On This Day query contract.

## Implemented

- A compact, count-free doorway beneath On This Day: “The days we chose to mark.” It is a full-card link whose visible wording is also its accessible name.
- Connected and detached-preview `/memories/milestones` journeys that preserve the center rail, reverse chronology, meaningful dates, family attribution, quiet ending, and existing edit, trash, note, and reaction actions.
- A truthful empty state, milestone-specific pagination language, route revalidation after mutation, and no invented milestone content or engagement totals.
- A dedicated `list_milestone_memories` RPC rather than a new mode on the mature year/anniversary RPC. It is `STABLE`, `SECURITY INVOKER`, uses an empty `search_path`, checks active circle membership, excludes trash and other moment kinds, and exposes execution only to authenticated callers.
- A live milestone partial index aligned with circle, occurrence date, time precision, precise instant, and moment ID ordering.
- Snapshot-plus-keyset traversal with a unique ID terminator, a 20-visible/21-requested page, server-derived cursors, and the existing bounded cumulative-page contract.
- Narrow-screen protection for long unbroken milestone titles, 44px-or-larger interactive targets, reduced motion, fixed-navigation clearance, and 200%-equivalent one-dimensional reflow.
- Correct landing semantics: On This Day, Milestones, and Browse by year now have separate labeled regions rather than sharing the On This Day landmark.

## Evidence available now

- `npm run check`: formatting, ESLint, TypeScript, 39 test files, and 341 unit/contract/component tests pass.
- `npm run build:webpack`: production compilation, route generation (including `/memories/milestones`), TypeScript, and the private-artifact scan pass.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 237 pgTAP assertions pass across six files. The Milestones suite directly covers ACLs and function posture, active/wrong/no-circle/revoked/anonymous identities, trash and kind filtering, input bounds, exact cursor continuation, 42 equal-date ties across three pages, duplicate prevention, and insert/edit exclusion after the first-page snapshot.
- `npm run types:db:check`: committed Supabase types match the rebuilt local schema.
- Detached Chromium passes navigation, Axe, private headers and RSC navigation, 320px and 200%-equivalent reflow, long-title wrapping, reduced motion, deep actions, moment-detail identity, and visual regression. The focused run passed 38 checks with five intentional project skips; the short-phone pass passed 24 with eight intentional skips.
- Firefox passes the Milestones route navigation, Axe, reflow, target sizing, long-title, reduced-motion, and deep-action checks. Two unrelated profile cases initially received transient text/plain local static assets and passed immediately in an isolated rerun.
- The new Milestones visual and intentionally changed Memories landing visual were inspected. Existing On This Day, year, composer, and detail baselines remain unchanged.
- Independent database/privacy and product/accessibility reviewers found no authorization blocker. Their equal-key snapshot coverage request was added. Their speech-control label-in-name blocker was fixed by removing the mismatched custom accessible name; focused tests passed afterward.

## Deliberate boundaries

- Milestones are authored moments, not a ranking, achievement system, notification source, or generated recap.
- Places remain family-entered labels. A Places archive can later use the generic collection-doorway model without being implied by this checkpoint.
- Photo upload and private derivative delivery remain pending PD-006. Video remains pending PD-004, and permanent purge timing remains pending PD-005.
- No hosted GitHub, Supabase, Vercel, email, domain, worker, analytics, billing, or production-secret resource was created.

## Next gate

Finish the remaining decision-independent Family Context administration and export groundwork, while retaining hosted default-build, Linux WebKit, and real-iPhone evidence as release gates. Production media work still requires PD-006; video and irreversible purge can remain pending under PD-004 and PD-005.
