# Our Days — load, upload, and flow performance audit

> **Do not build yet — Brian picks.** This is a discovery-only audit. No app code,
> config, schema, or production setting was changed. Every item below is a
> proposal; each chosen item gets its own build brief → PR → Preview → phone soak.

- **Date:** 2026-09-23 · **Baseline:** `main` @ `0034902` (#129)
- **Scope:** cold open / first paint, photo + video upload, everyday flow
- **Supporting notes:** [`critical-paths.md`](./critical-paths.md) (step-by-step
  maps with round-trip counts) · [`measurements.md`](./measurements.md) (raw
  numbers, commands, and the read-only checks made in this run)

## Executive summary

1. **Geography is the biggest measured cost.** Production Functions run in Vercel `iad1` (US East) but Supabase is in `us-west-1`, so every server→database call crosses the continent (~60–70 ms). A cold open makes ~6–9 of them in sequence before the first post, each photo 3 more, and each uploaded photo's server processing ~15.
2. **Moving Functions to `sfo1` is a settings change and should ship first.** Re-measure afterwards: it shrinks every round-trip item below by roughly 10–20× and may reorder them.
3. **The server repeats work.** The feed RPC runs twice per open, one after the other. Enrichment chains 3–4 serial queries for names the page already has. Just me, Account, Trash, and Memories compute activity inline before painting. Each return to the app re-renders the whole route while two other refresh paths also fire.
4. **Taps wait on invisible work.** Hearts, comments, and posts block on Web Push fan-out with no timeout, and each written post triggers up to three full feed renders.
5. **Uploads are strictly serial.** A 6-photo post hashes, uploads, and server-processes one photo at a time, although the database already supports attaching to a reserved moment.
6. **Cold-open JS on `/family` is ~245 KB brotli, and ~40% of it (supabase-js, composer, upload code) isn't needed until Add.** Static JS/CSS also pays ~50 ms each for an unneeded proxy pass (measured).
7. **Media:** each photo costs 3 serial hops plus whole-file buffering, feed cards (the only photo view) load the full 2560-px derivative, and the photo memory cache expires after 60 s.
8. **Recommended first batch:** P0-1 through P0-9, in order. All are S or S–M and change no IA or visuals.

## Ranking legend

| Rank | Meaning |
| --- | --- |
| **P0** | Clear win, high confidence, low/medium risk, mostly S effort |
| **P1** | Strong win, more effort, risk, or a policy decision |
| **Later** | Speculative, product-adjacent, or needs an ADR change |

Effort: **S** ≈ one focused PR touching a few files · **M** ≈ several modules
and new tests · **L** ≈ pipeline/schema/ADR work. Latency estimates assume
~65 ms per `iad1`↔`us-west-1` round trip. They are estimates to confirm with
the measurements listed in each item.

---

## P0 — clear wins

### P0-1 · Run Vercel Functions next to Supabase (`sfo1`)

- **Evidence:** Production responses report `x-vercel-id: pdx1::iad1::…`
  (edge `pdx1`, Function `iad1`). Supabase project metadata reports region
  `us-west-1`. Nothing in the repo pins a region (no `vercel.json`, no
  `preferredRegion`). Serial server→Supabase chains:
  `src/app/page.tsx:15` → `src/lib/auth/journal-access.ts:157`;
  `src/data/journal-context.server.ts:642-713`;
  `src/data/moments.server.ts:774-831` and `:137-211`;
  `src/app/api/media/moments/[momentId]/route.ts:83-95`;
  `src/lib/photo-worker.server.ts:79-96, 360-615`.
- **Change:** Set the project's Function region to `sfo1` (Vercel → Settings →
  Functions, or `vercel.json` `"regions": ["sfo1"]`). Try it on Preview first.
  Confirm that both the proxy and the page Functions report `sfo1` in `x-vercel-id`.
- **User effect (estimate):** Time to first post drops by about 0.4–0.9 s,
  first photo bytes by about 0.2 s, and each heart, comment, or post ack by about
  0.2–0.3 s. Each photo's server processing drops by about 1–3 s, so a 6-photo
  post finishes 6–18 s sooner, even before P1-1.
- **Risk:** Low. No code change. Phones far from California pay one longer
  phone→Function hop per request, while each request saves the same distance on
  about 8–15 serial database calls.
- **Effort:** S · **Metric:** median `headersMs` in the existing
  `[preview-supabase-timing]` log (`src/lib/supabase/server.ts:13, 37-58`);
  phone time-to-first-post and time-to-first-photo.

### P0-2 · Stop running the proxy on static assets

- **Evidence:** The matcher (`src/proxy.ts:72-76`) includes `/_next/static/*`.
  The proxy only returns early there (`:35-38`) after building a nonce CSP,
  which JS/CSS files don't use. Measured from the same edge: a cached JS chunk
  through the proxy has 90–116 ms TTFB, versus 46–57 ms for an excluded static
  icon.
- **Change:** Also exclude `_next/static`, `_next/image`, `manifest.webmanifest`,
  and `robots.txt` in the matcher (icons are already excluded). Static assets keep
  the baseline headers from `next.config.ts` (`config/http-security.ts`). Update
  `src/proxy.test.ts`.
- **User effect:** About 45–65 ms off every uncached JS/CSS request. This matters
  most on the first open after each deploy, when all chunk URLs are new.
- **Risk:** Low (security headers stay; CSP applies to documents). · **Effort:** S
- **Metric:** chunk TTFB; cold-open time on the first open after a deploy.

### P0-3 · Send Web Push after the response, with a timeout

- **Evidence:** `setMomentReactionAction`, `createMomentNoteAction`,
  `createFamilyMomentAction`, and `createWrittenMomentAction` each
  `await deliverActivityWebPush(...)` before returning
  (`src/features/moments/moment-actions.ts:299-301, 813, 960-962, 1038-1040`).
  That awaits a deliveries RPC, then `Promise.all` of pushes to Apple/Google
  (`src/lib/web-push/deliver-activity.ts:57-127`), and `fetch` has no timeout
  (`src/lib/web-push/send.ts:189-199`).
- **Change:** Wrap delivery in `after()` from `next/server` (stable in Next 16;
  runs via `waitUntil` on Vercel) and add `AbortSignal.timeout` (about 5 s) per
  push. Keep the existing push-coalescing rules unchanged (no new pushes).
- **User effect:** Hearts, comments, and posts are acknowledged after the write,
  not after push fan-out. This removes an unbounded tail today.
- **Risk:** Low. Push still fires; failures are only logged, as today. · **Effort:** S
- **Metric:** server-action duration p50/p95 for reaction, note, and create.

### P0-4 · One feed query per open; start the remainder immediately

- **Evidence:** The family page awaits the opening timeline, then renders the
  remainder inside it (`src/app/(journal)/family/page.tsx:92-126`), so the
  second query starts only after the first finishes. Both call
  `loadConnectedTimeline`, which runs `list_all_timeline_moments` with
  `page_size` 21 (`src/data/moments.server.ts:756-778`). The opening keeps 1
  row (`enrichLimit: 1`) and the remainder re-reads the same 21 rows
  (`src/data/family-home.server.ts:210-262`). The snapshot is not shared either,
  which is still open as reliability review item 3.
- **Change:** Fetch page rows once per request (a React `cache()`d promise that
  also carries the snapshot). Stream enrichment of row 1 first, then rows 2–20.
  Start the remainder's enrichment without waiting for the opening's render.
- **User effect:** The rest of the first page appears one RPC plus one
  enrichment chain sooner, and there is one fewer feed RPC per open, refresh, or
  resume. It also closes the offset-drift risk.
- **Risk:** Low–medium (streaming order; `FeedSaveAcknowledgment` tests).
  · **Effort:** S–M
- **Metric:** feed RPCs per open (2 → 1); time from first post to full first page.

### P0-5 · Collapse the serial enrichment chains

- **Evidence:** Conversations run notes‖reactions → `circle_memberships` →
  `people` → `visible_moment_authors`, up to 4 steps
  (`src/data/moments.server.ts:137-211`), to find names and accents that the
  journal context already loaded (`memberNames`, roster people;
  `src/data/journal-context.server.ts:749-757, 857-862`). Video meta and posters
  run one after the other (`moments.server.ts:567-589`). The context runs a second
  `circles` query after its `Promise.all`, for IDs it already knew
  (`journal-context.server.ts:649-655` vs `:696-713`).
- **Change:** Resolve authors from the context and call `visible_moment_authors`
  only for out-of-roster IDs. Run the video and poster reads in parallel. Merge the
  two `circles` reads into one.
- **User effect:** Every feed render (opening, remainder, Just me, refresh) is 2–3
  serial round trips shorter.
- **Risk:** Low (keep "display-only attribution" behavior). · **Effort:** S
- **Metric:** serial Supabase calls per render; server render time.

### P0-6 · Just me paints like All circles; activity out of page renders

- **Evidence:** `loadPersonJournal` calls `loadConnectedJournalContext(access)`
  (`src/data/person-journal.server.ts:153`), where activity defaults to on and
  runs inline (`journal-context.server.ts:631, 678-685`, chain at `:378-548`). The
  page then awaits the full timeline with no streaming
  (`src/app/(journal)/people/[personId]/page.tsx:77-81`). Account
  (`account-screen.tsx:139`), Trash (`trash.server.ts:77`), and Memories
  (`memories-home.server.ts:173, 193`) also pay for inline activity. The bell
  already updates from the client poll (`activity-banner.tsx:26-98` →
  `notification-center.tsx:132-140`), and on All circles activity is computed
  twice: server `FamilyActivity` (`family/page.tsx:55-64`) plus the mount poll.
- **Change:** Default `includeActivity` to false. Compute activity once, either
  the streamed server slot or the client poll, not both. Give Just me the same
  shell → first post → remainder streaming as All circles.
- **User effect:** Faster Just me ↔ All circles switches, faster Account, Trash,
  and Memories, and cheaper refreshes on those pages.
- **Risk:** Low (the bell dot may appear a moment after hydration). · **Effort:** S–M
- **Metric:** tap → first post for Just me; activity queries per open (2 → 1 sets).

### P0-7 · One refresh per write, not three

- **Evidence:** A written post runs `router.replace(familyRedirect)` immediately
  (`src/features/composer/moment-composer.tsx:1529-1533`). The action
  `revalidatePath`s the current route
  (`moment-actions.ts:176-186, 302`), which in Next 16 re-renders the current
  page inside the action response. Then `onPublished: () => router.refresh()`
  renders it again (`moment-composer.tsx:1527`,
  `optimistic-moment-save.ts:77-84`). The edit path does
  `router.replace(pathname); router.refresh()` (`:1375-1376`). Photo posts refresh
  on both accepted and published (`photo-status-shelf.tsx:964-999`).
- **Change:** Keep exactly one refresh per completed write (either the action's
  revalidation or one client refresh), and drop the redundant `replace` when
  already on the target URL.
- **User effect:** The post settles sooner with less flicker, and there are two
  fewer full renders per post (each render is ~10–15 database calls).
- **Risk:** Medium (acknowledgment and chip-clearing rely on refreshed entries;
  keep the #67/#73 regression tests green). · **Effort:** S–M
- **Metric:** full page renders per post (3 → 1); post → acknowledged time.

### P0-8 · Make foreground refresh conditional and single-path

- **Evidence:** Every hidden→visible change triggers a full `router.refresh()`
  after 1.2 s, with no minimum time away
  (`src/features/timeline/timeline-refresh-control.tsx:75-118`,
  `timeline-resume-refresh.ts:1`). In parallel, the activity banner polls
  `/api/activity` (`activity-banner.tsx:77-90`) and the photo shelf calls
  `list_my_photo_intakes` (`photo-status-shelf.tsx:921-937`).
- **Change:** Refresh only after a meaningful absence (for example, ≥ 60 s hidden
  or ≥ 60 s since the last refresh). When a refresh is scheduled, skip the
  separate activity poll. Keep pull-to-refresh as the explicit full refresh.
  Keep #57's behavior for real resumes.
- **User effect:** Quick app switches (checking a text, the share sheet) no longer
  cause a full re-render, jank, and data use. Real returns still refresh.
- **Risk:** Low–medium (product expectation from #57). · **Effort:** S
- **Metric:** full renders per foreground hour; resume → settled time.

### P0-9 · Take the `/` redirect hop off cold open

- **Evidence:** The PWA `start_url` is `/` (`src/app/manifest.ts:9`). `/` runs
  identity plus a memberships query, then 307s to `/family`
  (`src/app/page.tsx:8-17`), which repeats identity.
- **Change:** In the proxy, redirect `/` → `/family` when claims are valid (the
  page keeps its own checks, per ADR-020). Set `start_url` to `/family` for new
  installs; existing Home Screen installs keep `/`.
- **User effect:** One fewer Function render plus a database call on every cold
  open; new installs skip the extra round trip entirely.
- **Risk:** Low. · **Effort:** S · **Metric:** document TTFB on cold open.

---

## P1 — strong wins, more effort or a decision

### P1-1 · Pipeline multi-photo uploads

- **Evidence:** `runPhotoUpload` loops `for … await uploadPhotoMoment`
  (`src/features/composer/optimistic-media-upload.ts:225-272`). Each file hashes
  (`photo-upload.ts:684-685`), then makes 4 serial RPCs, a TUS transfer, and a
  synchronous processing request of up to 300 s (`:827-1043`,
  `api/photos/process/route.ts:13, 114`) before the next file starts. The whole
  queue is also single-flight (`optimistic-media-upload.ts:408-427`). Meanwhile
  `attach_photo_to_moment` already supports a reserved-but-unpublished moment
  (`supabase/migrations/20260904234931_multi_photo_moments.sql:580-703`).
- **Change:** Hash every file at pick time (in the worker). Reserve and attach in
  the user's order (cheap, keeps `sort_order`), then run TUS transfers and
  processing with concurrency 2–3. Preserve one announce push per batch
  (#70 invariant) and the quota errors.
- **User effect:** A 6-photo post takes about as long as its slowest photo plus a
  little, not the sum of all six. Fewer photos are left mid-flight if iOS kills
  the app.
- **Risk:** Medium (ordering, quotas, retry, chip states). · **Effort:** M
- **Metric:** pick → all published for 6 photos; bytes/sec during transfer.

### P1-2 · Leaner server photo processing (same evidence steps)

- **Evidence:** Each `/api/photos/process` call signs the worker in again with
  `signInWithPassword` (`photo-worker.server.ts:79-96`), then runs about 12 more
  serial steps: 4 RPCs, 2 object-info reads, 3 downloads plus 1 upload of the
  original, and an upload plus read-back of the derivative (`:360-471, 473-615`).
  The route adds `auth.getUser()` (a network call) and two status RPCs
  (`process/route.ts:84-91, 154-157`). The logs have no stage timings.
- **Change:** Process a batch's intakes in one request with bounded concurrency
  and one worker sign-in. Replace `getUser()` with claims. Add stage timings.
  Keep every ADR-044/045 verification step.
- **User effect:** Photos reach "published" sooner, especially multi-photo posts.
- **Risk:** Medium (lease and retry semantics). · **Effort:** M
- **Metric:** processing time per photo and per batch from the new stage logs.

### P1-3 · Load composer, upload code, and supabase-js on demand

- **Evidence:** Local webpack build of `/family`: about 972 KB raw / 286 KB gzip /
  245 KB brotli JS. supabase-js (auth + realtime) is ~255 KB raw / 68 KB gzip, the
  composer ~102 KB raw, upload/status ~52 KB raw. They load eagerly because
  `MomentComposer` is always mounted (`composer-session.tsx:129-153`) and
  `PhotoStatusShelf` statically imports the browser client, which it creates on
  mount to call `list_my_photo_intakes` (`photo-status-shelf.tsx:11, 617-620, 920`).
  That last call also opens a second origin (a new TLS connection) during cold open.
- **Change:** `next/dynamic` the composer and prefetch it at idle so the iOS
  keyboard-on-open behavior holds. Lazy-import the browser client inside the upload
  and status functions. Move the mount-time intake check to idle, or gate it on
  local resume records.
- **User effect:** About 40% less JS to download, parse, and hydrate before the
  feed is interactive (most visible on older iPhones and after deploys).
- **Risk:** Low–medium (focus and keyboard timing on first Add). · **Effort:** M
- **Metric:** JS bytes before first post; long tasks during cold open (Web Inspector).

### P1-4 · Fewer hops per private media request

- **Evidence:** Photo, poster, and every video Range request each run the
  delivery RPC → `createSignedUrl` → storage GET
  (`api/media/moments/[momentId]/route.ts:83-95`, `private-media-delivery.ts:86-115`,
  `api/media/videos/[momentId]/route.ts:165-187`, `…/poster/route.ts:67-77`).
  Photos are fully buffered and hashed before the first byte (`route.ts:104-115`).
  Display-bucket SELECT no longer depends on the operation name
  (`20260913132814_align_display_reads_with_video_signed_urls.sql:1-19`).
- **Change:** Download directly with the viewer's JWT (the ADR-049 wording),
  which drops `createSignedUrl`. Stream photo bytes while hashing, failing closed
  by erroring the stream on mismatch. Needs a security review.
- **User effect:** About 1 fewer serial hop per photo, poster, and video range, and
  earlier first bytes.
- **Risk:** Medium (security-sensitive path). · **Effort:** M
- **Metric:** `/api/media/*` duration p50/p95; first photo decoded.

### P1-5 · Longer in-memory photo cache (privacy call)

- **Evidence:** The blob cache keeps 24 entries / 16 MB for 60 s
  (`src/lib/private-media-memory.ts:2-4`). Switching journals remounts cards, so
  photos older than a minute re-download through the full route.
- **Change:** Session-scoped memory only, for example 15 min / 60 entries /
  48 MB, still cleared on `our-days:clear-private-state`. Nothing on disk.
- **User effect:** Instant photos when switching back and forth.
- **Risk:** Low technically; **needs Brian's OK** on the privacy window. · **Effort:** S

### P1-6 · A phone-sized display derivative

- **Evidence:** The one display derivative is 2560-px max edge, WebP q82
  (`scripts/lib/photo-display-derivative.mjs:11, 515-528`). It is served to the
  inline feed card (`features/moments/moment-photos.ts:14, 63-67`), which is now
  the only photo view (#80–#82 removed the photo lightbox;
  `double-tap-photo.tsx:8`). A 390-pt card at 3× needs about 1170 px, so each
  photo decodes about 4–5× the pixels, with bytes likely 2–4× (estimate).
- **Change:** Add transform profile v2 with a ~1600-px max edge for new uploads.
  Originals stay immutable (ADR-009), so existing photos can be regenerated later.
  This touches the ADR-045 profile, worker, and tests.
- **User effect:** Faster photo paint, smoother scrolling, and less iOS memory
  pressure (fewer reloads that look like cold opens).
- **Risk:** Medium (the profile is an ADR-045 contract). · **Effort:** M (L with a
  backfill) · **Metric:** bytes per feed photo; photo decode time.

### P1-7 · Incremental "Show earlier days"

- **Evidence:** Pagination is a full-page navigation with a cumulative `pages=N`
  (`timeline-feed.tsx:213-224`). Both the opening and the remainder re-read N pages
  serially (`moments.server.ts:774-799`, up to 25 pages). ADR-029 already says
  this "must become incremental before scale makes that costly."
- **Change:** Append one keyset page with the same snapshot via an action or
  route handler.
- **User effect:** The earlier-days tap stays constant-time instead of growing
  with depth. · **Risk:** Medium (scroll memory, acknowledgment). · **Effort:** M

### P1-8 · Bound the worst-case open

- **Evidence:** Reads have an 8 s per-request deadline (`lib/supabase/server.ts:16-33`),
  but timeouts count as "transient" and are retried
  (`lib/auth/family-session-error.ts:58-89`, `journal-access.ts:57-69`). All
  circles then falls back to the single-circle RPC, which is also retried
  (`moments.server.ts:774-782`, reliability review item 2). A degraded first page
  then reloads everything (`family-home.server.ts:203-206`). During a Supabase
  brownout, "These days couldn't open" can take tens of seconds to appear.
- **Change:** Don't retry timeouts. Skip the recovery reload after a timeout.
  Don't silently narrow All circles. Add one overall budget per render.
- **User effect:** Fast, honest failure instead of a long stall. · **Risk:** Low–medium · **Effort:** S–M

### P1-9 · Optimistic comment posting

- **Evidence:** `saveNote` awaits the create action (including push, see P0-3),
  then a second `loadConversation` action, before the note shows and the panel
  closes (`moment-conversation-control.tsx:393-447`). Reactions are already
  optimistic (`:321-358`).
- **Change:** Insert a pending note immediately and reconcile, restoring the draft
  on failure. · **Effort:** S–M · **Risk:** Low–medium

### P1-10 · Video uploads that survive an app kill

- **Evidence:** The TUS upload URL for video is kept only in memory
  (`video-upload.ts:475-477`). Photos persist resume records in IndexedDB
  (`photo-upload-resume-store.ts`). Videos are up to 100 MB and 60 s
  (`video-upload.ts:14-15`), and retries give up after about 19 s of failures
  (`:304`).
- **Change:** Persist the reservation and upload URL like photos, and resume from
  the shelf. · **Effort:** M · **Risk:** Medium

### P1-11 · Database: measure first, then trim visibility work and add indexes

- **Evidence:** Both feed RPCs are `security invoker`
  (`20260923143000_insight_circle_audience.sql:180-555`). `moments` RLS calls the
  security-definer `can_read_live_moment(id)` per row
  (`20260907204138_moment_circles.sql:49-81, 255-260`). The RPCs repeat
  visibility predicates, and the circle RPC calls `can_read_live_moment` again
  (`…insight_circle_audience.sql:311`). The cross-circle ORDER BY has no matching
  index. There is no index on `moments.recorded_by_membership_id` (used by
  activity, `journal-context.server.ts:388-392`). Notes and reactions indexes lead
  with `circle_id` (`20260830153119_phase_5_family_context.sql:73, 104`), but
  feed and activity queries filter by `moment_id` or `author_membership_id` only.
- **Change:** Read Supabase Query Performance and Advisors (read-only). Then add
  the missing indexes or `circle_id` filters, and avoid the double visibility
  checks if EXPLAIN shows cost. · **Effort:** S–M · **Risk:** Low–medium (RLS)

---

## Later — speculative, product-adjacent, or needs an ADR change

| # | Idea | Why later |
| --- | --- | --- |
| L-1 | Reuse recently visited journals on Just me ↔ All circles (`experimental.staleTimes.dynamic`), or prefetch the two primary journals | Experimental flag; ADR-021 keeps `prefetch={false}` |
| L-2 | Service worker precache of the versioned public `/_next/static` set (ADR-011/022 allow it) | Only if Web Inspector shows iOS evicting the HTTP cache |
| L-3 | Video Range via a short-lived signed-URL redirect (ADR-010 permits "tightly controlled short-lived" URLs) | Threat-model item 23, CSP `media-src`, and mid-play expiry |
| L-4 | Derive the display image from the verified read-back instead of re-downloading the original | Changes ADR-044/045 evidence; security decision |
| L-5 | Scroll-away header writes `--journal-nav-scroll-offset` on `:root` each scroll (`use-scroll-away-header.ts:31-38`), which can invalidate style for the whole feed; write it on the nav instead | Measure jank first |
| L-6 | Video TUS chunk size is 2 MB (`video-upload.ts:178-179`); Supabase documents 6 MB | Deliberate flaky-network choice; measure throughput |
| L-7 | Composer remounts on every journal switch (its `key` includes home context, `composer-session.tsx:133-137`) | Cheap while closed; revisit with P1-3 |
| L-8 | Narrow `refreshMomentSurfaces` (8 `revalidatePath` calls) | Low value while every route is dynamic |

## Tiny enablers (called out separately)

- **E-1 · Server timing in Production for a soak window:** extend the preview-only
  `[preview-supabase-timing]` log (no IDs or paths) or emit `Server-Timing`.
- **E-2 · Client marks:** `performance.mark` for shell painted, first post painted,
  and first photo decoded, readable in Safari Web Inspector.
- **E-3 · Photo processing stage durations** in the `[photo-process]` logs.

## Needs Brian's phone measurement before coding

Use Safari on a Mac → Develop → *iPhone* → *Our Days* (Web Inspector attaches to
Home Screen apps), or a stopwatch. Capture a baseline, then repeat after P0-1:

1. Cold open after more than 1 h idle, three times: shell visible, first post, first photo.
2. Just me → All circles → Just me: tap → first post each way.
3. Heart → saved; comment → visible.
4. 6-photo post: Post tap → all photos published. 60 s video: Post → published.
5. Web Inspector Network on one cold open: document TTFB, chunk TTFB, first
   `/api/media/moments/*` timing.

P0-1's result decides how much P0-4/5/6 still matter. P1-6 and L-2 need the
Web Inspector evidence.

## State of previously fixed items

- **JournalInterrupted:** Inside the persistent shell, errors now render in place
  (`journal-interrupted.tsx:8-35`). The fatal set is narrow
  (`family-session-error.ts:7-10, 52-56`), and transient errors auto-retry once
  (`journal-route-boundary.tsx:16-69`). Family and person pages soft-fail instead
  of throwing. The remaining latency risk is timeout amplification (P1-8).
- **Paused/stuck chips:** Polling happens only while work is active (10 s,
  `photo-status-shelf.tsx:956-962`), plus on resume and online (`:921-937`), and
  stuck "processing" rows are re-requested (`:638-668`). The gap: videos can't
  resume after an app kill (P1-10).
- **Multi-photo push spam:** Still coalesced: only the first file announces
  (`optimistic-media-upload.ts:234`, `activity-notifications.ts:51-58`), and the
  processing route never pushes (`process/route.ts:94-97`). P1-1 must keep this.

## Guardrails respected

- No IA or visual change: the Just me | All circles header, decoration-only
  audience chips, the Journal · Add · Circles nav, Insight chrome (#129), inline
  media, and native video fullscreen are untouched. Blur and backdrop costs are
  noted but left alone because they're design-locked.
- P0/P1 stay inside ADR-010/011/014/020/021/022/026/029/042/044/045/049. Anything
  that needs an ADR change is in **Later** and labeled.
- Production was not mutated. The read-only checks are listed in
  [`measurements.md`](./measurements.md).
