# Reliability review — September 18, 2026

## Product constraint

Our Days is a simple, private family journal. Prioritize opening, posting,
editing, viewing media, commenting, switching journals, and refreshing. Avoid
new infrastructure, an enterprise rewrite, palette work, or new features.
This is the first reliability pass, not certification that every code path or
the installed iPhone PWA is fixed.

Baseline: `d8eca81` on main. Read `OUR_DAYS_STATUS.md` and inspected the scope of
open draft PR #78; did not merge it or the old Codex handoff branch.

## Fixed in this pass

- **A completed navigation could resurrect its loading screen on Back.**
  `JournalPendingRouteProvider` retained its previous destination after commit.
  Clear it when the pathname commits. Regression reproduced before the fix.
- **Application assets unnecessarily waited for authentication.** The proxy ran
  `getClaims()` on JavaScript/CSS requests as well as pages. Keep CSP handling,
  but skip the session client for `/_next/static/` requests. Page/API auth stays
  unchanged. This removes a cold-cache dependency; it is not proof of the
  reported iPhone root cause.
- **Feed reads and photo downloads could remain pending indefinitely.** Add an
  opt-in eight-second per-request deadline for timeline/context reads. Default
  mutation/upload clients are unchanged. Abort abandoned private photo fetches
  and expose the existing retry state after twenty seconds.
- **Independent feed metadata loaded serially.** Fetch photo metadata, video
  metadata, and conversations concurrently.
- **Local journey command could reject every save.** `NEXT_PUBLIC_SITE_URL`
  was compiled from `.env.local` at build time, while the browser test ran on
  port 3102. Pin the build origin in `test:e2e:local-journal` to match its server.
  Do not relax origin validation.

## Remaining findings, in priority order

1. **Installed-iPhone cold-open / first-feed hang is not closed.** No connected
   real-device trace was captured in this pass. Identity bootstrap and proxy
   authentication still have separate network waits; the new deadline is not
   an end-to-end eight-second load guarantee. Follow the actual failing request
   before adding retries or another recovery layer.
2. **All-circles failures can silently degrade to one circle.** In
   `loadConnectedTimeline`, an initial all-circles RPC error switches to the
   circle RPC. The selected scope can therefore suggest a complete feed when
   the result is partial. Review this alongside #78 without importing its
   changes wholesale.
3. **Opening and remainder feeds query separately.** The family page passes
   the incoming snapshot option to both requests. Without an explicit snapshot,
   a concurrent insert between them can change the offset boundary. Reproduce
   with a controlled insert, then share one snapshot or query result.
4. **Pending-save durability needs a focused pass.** The optimistic written-save
   queue is in memory, and the composer clears its persisted draft when saving
   starts. Normal posting passes, but reload during an unsuccessful save and
   repeated retry need explicit tests before claiming draft safety.
5. **The handoff and code disagree about one navigation label.** Main renders
   `Account` in the third bottom-nav slot; the handoff says `Circles`. This pass
   leaves the shipped UI unchanged rather than partially renaming it.

## Verification

- Broad unit run during this pass: 1,479 passed, three skipped.
- Subsequent focused tests for navigation, read deadlines, media cleanup,
  opening shell, and timeline reads: 38 passed; proxy suite: 30 passed.
- Typecheck and lint passed; final changed-file lint passed.
- Production webpack build and private-artifact scan passed.
- Synthetic local mobile-Chromium journeys: four passed after correcting the
  test-origin mismatch. Covers sign-in/cold opening, text/photo/video posting,
  inline video playback, date browsing, and own-vs-other personal visibility.
- These local journeys do not exercise hosted Supabase, installed iOS PWA
  lifecycle, server fault injection, or all edit/comment paths.

The initial build needed lockfile dependency synchronization because local
`node_modules` lacked main's MapLibre dependency. The initial journey run
failed on the test-origin mismatch described above. Both causes were diagnosed;
tests were not weakened or retried blindly. No production deployment or hosted
database changes were made.

## Next pass

Keep this PR narrow. Capture/reproduce the connected first-feed failure; test
All-circles refresh and Back/remount with injected failures; then verify
edit/comment/reaction and interrupted-save recovery. Preserve the existing IA
and media behavior. Do not describe a local test pass as real-PWA verification.

## Preview sign-in follow-up

Confirmed against the deployed preview: starting Google OAuth on the immutable
build hostname wrote PKCE verifier cookies on that hostname, but `redirect_to`
pointed to the branch alias. The callback therefore could not receive those
host-only cookies. The callback reports this exchange failure as an invalid
sign-in link, explaining the misleading message after Google sign-in.

The OAuth start route now redirects preview requests to the configured callback
origin before creating any auth state. Google and X regression tests fail before
the fix and pass after it. Production/local behavior is unchanged; no cookie
domain broadening or authentication bypass is used.

Preview handoff rule: share the branch-alias URL, not the immutable build URL.
Generate any Vercel access link for that same alias. Check the OAuth start
response without following Google: callback origin must equal the verifier
cookie host. The stable alias passed that live check. Vercel share-link expiry
is separate from journal authentication; this fix does not make share links
permanent. Full Google login and installed-iPhone feed verification remain open.

## Slow-feed follow-up

User reports roughly six seconds to first paint, ten more to the first photo
carousel, and twenty seconds to switch Just me to All circles. Preview runtime
logs show a burst of many media requests during a feed load. They do not provide
per-query durations, so these observations do not yet identify the entire delay.

Confirmed code issue: private photos start fetching on mount, including all
parked carousel slides and off-screen cards. Image `fetchPriority` previously
applied to the resulting blob, not the network request. Defer non-priority
photos until their carousel is within 200px of the viewport, and apply priority
to the actual fetch. Observe the carousel rather than hidden slides to preserve
the existing swipe preloading behavior. Keep host-only authorization, no-store,
retry, and request cancellation unchanged.

Preview-only Supabase request logs now emit operation category, response status,
and time to response headers. They exclude queries, object paths, tokens, IDs,
and payloads. This will distinguish slow feed/auth queries from media congestion
without adding monitoring infrastructure. It is not total response-body timing.

Focused media/timing tests: twelve passed. Production build, artifact scan,
typecheck and lint passed; four local mobile journeys passed with deferred
loading. The final network-priority hint has focused test coverage. No measured
installed-iPhone speed improvement is claimed yet. The twenty-second feed switch
remains open pending request timings from the updated preview.

## Device confirmation and separate carousel follow-up

Brian reported substantially faster initial media and Just me / All circles
switching, then confirmed three successful installed-iPhone cold opens at
approximately 3–5 seconds each. This supersedes the unverified device-speed
status above for those tested opens, not a guarantee against every intermittent
failure. PR #86 was merged as `75a0526` after that confirmation and explicit
merge approval. Quality, the required PR gate, all three critical browser
engines, and the local journal journey passed. Non-gating database-validation
and Intel visual-baseline failures remain visible; they were not waived into
claims of a completely green suite.

The carousel follow-up stays separate: mount the first photo only, warm its
immediate neighbors after it settles, and retain mounted photos while the card
is open. Demand-load a neighbor if the user swipes before warming finishes.
Wait for authenticated bytes and image readiness before moving the slide;
a failed fetch must expose its retry control, not leave the gesture waiting.
No persistent media cache, new service, schema change, or IA change is involved.

Local production-build verification: five mobile-Chromium journeys passed,
including a synthetic six-photo upload, reload, and forward/back swipes. The
browser recorded three initial private-photo requests, one more for the next
neighbor after advancing, and no repeat request on returning. The original
blob URL remained mounted; no page errors were observed. Screenshot inspected.
Build and artifact scan, typecheck, lint, and formatting passed. Forty focused
card/pager/readiness tests passed. The first broad unit run exposed an old
eager-mount assumption in the card test (updated to simulate sequential image
loads) and a note-edit test that dropped its final typed period under parallel
load; the latter passed when isolated, with no composer changes. This is local
browser evidence, not installed-iPhone verification of the new carousel code.
The final broad run, limited to four workers after the card fixture correction,
passed: 1,493 tests passed, three skipped. No repeated production builds were
needed for this follow-up.
