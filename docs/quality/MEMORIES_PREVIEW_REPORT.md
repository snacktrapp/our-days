# Memories functional preview evidence

Date: 2026-08-29 (America/Los_Angeles)

Status: decision-independent functional front-end preview. This is evidence for the central browsing experience, not a claim that production On This Day, database authorization, or family-circle isolation is complete.

## What this checkpoint proves

- `/memories` is a quiet entry point with a real On This Day link and descending year links derived from one canonical archive.
- `/memories/on-this-day` and `/memories/years/[year]` preserve the center rail, date markers, elapsed gaps, member identity, and the shared moment-card language.
- The canonical preview archive is shared by Family, personal, year, and anniversary views; fixture dates and content cannot drift between those screens.
- Photo, thought, location, and milestone moments remain visually distinct while using the same timeline grammar.
- An empty anniversary still presents the rail and a restrained explanation instead of an empty feed container.
- Invalid years use the private not-found experience, generic metadata, and noindex policy.

The frozen preview date is explicitly `2026-08-28`. It exists only to make the visual fixture deterministic. Production must resolve “today” in the family circle's stored IANA timezone, compare the month and day against the authoritative plain `occurred_on` date, and authorize current membership before querying or deriving metadata. February 29 matches February 29 exactly; no JavaScript timestamp conversion is used.

## Privacy and navigation evidence

- Every Memories route is request-rendered, private/no-store/noindex, preview-gated before constructing a fixture model, and excluded from private link prefetching.
- Preview-disabled document requests for the landing, anniversary, valid year, invalid year, and empty quality route redirect to the locked entry without fixture names, places, or media paths.
- Genuine browser-generated Next RSC navigation envelopes are captured for the nested routes and replayed against the locked server. Valid and invalid year requests return redirect-only RSC payloads with no private fixture content.
- Back, forward, reload, route-specific titles, descending year order, exact moment order, and visible elapsed-year gaps are browser-tested.

## Mobile, accessibility, and visual evidence

- Chromium and Firefox cover the landing, On This Day, year, and empty views with automatic console/page-error/request-failure monitoring and zero serious or critical axe findings.
- The Memories routes reflow at 320×568 without horizontal overflow or visible controls below 44 CSS pixels.
- A 200%-zoom-equivalent narrow viewport retains one-dimensional reflow, and deep Notes controls can scroll above the fixed safe-area-aware navigation.
- Reviewed pinned baselines include the 390px landing, On This Day, year, empty state, and a short-phone viewport capture of the landing.

## Verification snapshot

- `npm run check`: 14 test files and 148 tests passed.
- `npm audit --json`: 0 known vulnerabilities across 579 dependencies.
- `npm run test:e2e`: production webpack build and private-artifact scan passed; 68 browser checks passed, 24 project-specific checks were intentionally skipped, and 0 failed.
- Local Playwright inventory: 92 tests in 7 files. Prepared hosted CI inventory: 121 tests in 7 files, including WebKit.

Fresh current-tree mobile/accessibility and privacy/adversarial reviews both returned **GO** for committing this fixture checkpoint. They found no local defect beyond the external and production-data gates below.

## Deliberately deferred

- Production circle-timezone selection and database-backed `occurred_on` queries.
- RLS/current-membership, wrong-circle, revoked-member, and two-account denial evidence.
- Cursor pagination and archive scale behavior.
- Real WebKit, physical iPhone Safari/standalone, VoiceOver, safe-area, and software-keyboard checks.
- Milestone/place browsing beyond the currently approved timeline and year/date preview.

Those gates remain in the Supabase-backed and release phases. This checkpoint does not advance Phase 6 to complete.
