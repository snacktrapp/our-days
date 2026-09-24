# Critical paths — step-by-step maps

Supporting note for [`PERF-AUDIT.md`](./PERF-AUDIT.md). Baseline `main` @ `0034902`.

Legend for each step:

- **P↔V** phone ↔ Vercel (edge, then Function region `iad1` today)
- **V↔S** Vercel Function ↔ Supabase `us-west-1` (~60–70 ms per round trip today)
- **P↔S** phone ↔ Supabase directly (independent of the Vercel region)
- A "wave" is a set of calls that run in parallel; waves run one after another.

## 1. Cold open (installed PWA, `start_url` = `/`)

| # | Step | Where | Kind |
| --- | --- | --- | --- |
| 1 | `GET /` → proxy `getClaims()`. With an ES256 key this verifies locally; if the access token expired, it does one Auth refresh. | `src/proxy.ts:42-69` | V↔S only on refresh |
| 2 | `/` page: `readIdentity` → `getClaims()` (local) + `circle_memberships` select | `src/app/page.tsx:15`, `src/lib/auth/journal-access.ts:139-167` | 1 V↔S wave |
| 3 | 307 → `GET /family` → proxy again | `src/app/page.tsx:16` | P↔V |
| 4 | Layout (`PersistentJournalShell`) + `loading.tsx` skeleton flush (shell-first) | `src/app/(journal)/layout.tsx`, `loading.tsx` | — |
| 5 | Page: `readIdentity` again (new request, so `cache()` doesn't carry over) | `family/page.tsx:186-188` | 1 V↔S wave |
| 6 | `loadConnectedJournalContext` (activity off): circles(single) ‖ people ‖ memberships ‖ guardians | `journal-context.server.ts:642-686` | 1 V↔S wave |
| 7 | Second `circles` read for the switcher (same IDs as step 6) | `journal-context.server.ts:696-713` | 1 V↔S wave |
| 8 | Chrome paints (title, switcher, composer model) | `family/page.tsx:154-172` | — |
| 9 | Opening: `list_all_timeline_moments` (21 rows; keeps 1) | `family-home.server.ts:210-230`, `moments.server.ts:756-799` | 1 V↔S wave |
| 10 | Enrich row 1: photos ‖ video→poster (2) ‖ notes‖reactions → memberships → people (→ authors) | `moments.server.ts:817-831, 119-211, 549-617` | 1–4 V↔S waves |
| 11 | **First post paints** | | |
| 12 | Remainder: `list_all_timeline_moments` again (same 21 rows); starts only now | `family/page.tsx:113-122`, `family-home.server.ts:232-262` | 1 V↔S wave |
| 13 | Enrich rows 2–20 (same chain as step 10) | `moments.server.ts:817-831` | 1–4 V↔S waves |
| 14 | In parallel with 8–13: `FamilyActivity` (3 queries → authors → notes‖reactions → names → authors) | `family/page.tsx:55-64`, `journal-context.server.ts:550-620` | 2–5 V↔S waves |
| 15 | After hydration: `ActivityBanner` polls `/api/activity` (the same activity queries again) | `activity-banner.tsx:26-98`, `api/activity/route.ts` | P↔V + 3–6 V↔S |
| 16 | After hydration: `PhotoStatusShelf` creates the browser client → `list_my_photo_intakes` (second origin: new TLS) | `photo-status-shelf.tsx:617-620, 920` | P↔S |
| 17 | Photos near the viewport (800 px margin): `/api/media/moments/:id?photo=` per image | `private-photo-image.tsx:27-52` | P↔V + 3 V↔S each |

Serial V↔S waves before the first post: steps 2, 5, 6, 7, 9, and 10 add up to
**~6–9** (8 when the top post has reactions or notes). At ~65 ms each, that's
about 0.4–0.6 s of pure network wait, plus TLS setup on cold Function instances.
After moving to `sfo1`, each wave should take single-digit milliseconds.

JavaScript on `/family` (local webpack build): ~972 KB raw / 286 KB gzip /
245 KB brotli. supabase-js, the composer, and upload code (~410 KB raw) are part of
it, loaded because `MomentComposer` is always mounted
(`composer-session.tsx:129-153`) and the status shelf statically imports the
browser client. See [`measurements.md`](./measurements.md).

## 2. Resume / return to the app

1. `visibilitychange` (hidden → visible), then a 1.2 s debounce → `router.refresh()`,
   which re-runs the whole route: identity, context, both feed waves, and activity
   (`timeline-refresh-control.tsx:75-118`, `timeline-resume-refresh.ts:1`).
   There is no minimum hidden time.
2. At the same time, `ActivityBanner.resume()` polls `/api/activity`
   (`activity-banner.tsx:77-90`), and `PhotoStatusShelf` runs
   `checkStatuses(true)` → `list_my_photo_intakes`, re-requesting processing for
   any "processing" rows (`photo-status-shelf.tsx:921-937, 638-668`).
3. The scroll-away header re-measures and shows (`use-scroll-away-header.ts:68-75`).

Cost per quick app switch: one full route render (~10–20 V↔S calls, ~6–9 serial
waves), plus one activity request, plus one intake RPC.

## 3. Journal switches

- **Just me ↔ All circles:** switcher `Link` → `router.push(href)`
  (`family-title-switcher.tsx:183-209`). This is a fresh server render; there is no
  client reuse (`staleTimes.dynamic` defaults to 0, and ADR-021 keeps
  `prefetch={false}`). The pending skeleton shows immediately
  (`journal-pending-route.tsx`).
- **All circles (`/family`):** streamed as in §1, steps 5–14.
- **Just me (`/people/:id`):** not streamed. `loadConnectedJournalContext(access)`
  runs with activity on (inline chain), then the full timeline with 20-row
  enrichment, then paint (`person-journal.server.ts:143-173`,
  `people/[personId]/page.tsx:77-81`).
- **Circle/person drill-ins** and **Account → Journal** follow the same page
  loaders. Account, Trash, and Memories also load the context with activity inline
  (`account-screen.tsx:139`, `trash.server.ts:77`, `memories-home.server.ts:173, 193`).
- The composer remounts on each switch because its key includes home context
  (`composer-session.tsx:133-137`). That is cheap while it's closed
  (`moment-composer.tsx:1594`).
- Cards remount on navigation, so photos whose 60 s memory-cache entry expired
  re-download (`private-media-memory.ts:2-4`).

## 4. Photo post (single, multi, edit)

Client orchestration: `startOptimisticPhotoUpload` queues behind any active upload
(`optimistic-media-upload.ts:408-417`), then `runPhotoUpload` handles one file at
a time (`:225-272`). Per file (`photo-upload.ts:672-1085`):

| # | Step | Kind |
| --- | --- | --- |
| 1 | Header sniff (12 bytes), then full-file SHA-256 in a worker (incremental) | local CPU |
| 2 | `getSession` (local), draft fingerprint, IndexedDB resume lookup | local |
| 3 | `reserve_photo_moment` (first file) or `attach_photo_to_moment` (later files, and edits) | P↔S |
| 4 | Save resume record | IndexedDB |
| 5 | `claim_photo_intake_upload` | P↔S |
| 6 | TUS create + PATCH, 6 MB chunks, direct to Storage (ADR-042) | P↔S (1 request per 6 MB) |
| 7 | `acknowledge_photo_intake` | P↔S |
| 8 | `POST /api/photos/process`, waiting for the full worker run (below) | P↔V |
| 9 | `get_photo_moment_status` | P↔S |
| 10 | First file only: announce push via a server action (`optimistic-media-upload.ts:234`) | P↔V |

Server worker per intake (`process/route.ts:84-157`, `photo-worker.server.ts:617-630`):
`auth.getUser()` → status RPC → `signInWithPassword` → `claim_photo_validation` →
download the intake original → validate/decode → upload the canonical original →
download it again → validate/decode → object info → `complete_photo_validation` →
`claim_photo_display_derivative` → download the canonical original → validate/decode
→ resize to WebP (2560 px, q82) → upload the derivative → download it again →
validate/decode → object info → `complete_photo_display_derivative` → status RPC.
That's about 16 serial V↔S operations, 6 of them file transfers.

The feed shows the post after publication triggers a refresh, on both accepted and
published (`photo-status-shelf.tsx:964-999`). Until then the family sees the
status chip with a local preview.

The database already supports photos 2..N attaching to a reserved moment
(`multi_photo_moments.sql:580-703`, `existing_request` branch; 6-photo limit at `:626`).

## 5. Video post

`inspectVideoFile` (skipped if the composer already has duration and poster) →
`reserve_video_moment` → TUS, 2 MB chunks, retry delays `[0, 1s, 3s, 5s, 10s]` →
`finalize_video_moment` → announce push → `persistVideoPoster` after publish
(`optimistic-media-upload.ts:333-405`, `video-upload.ts:381-505`). There is no
server transcode. Limits: 100 MB, 60.5 s (`video-upload.ts:14-15`). The upload URL
is kept only in memory (`:475-477`), so an app kill restarts from zero.

## 6. Media display

- **Photo:** card → `PrivatePhotoImage` → deferred until within 800 px →
  `fetch(no-store)` → blob URL (`private-photo-image.tsx`,
  `use-private-media-object-url.ts:24-83`). Server route: proxy → delivery RPC →
  `createSignedUrl(60 s)` → storage GET → whole-body `arrayBuffer()` → SHA-256 →
  response `private, no-store` (`api/media/moments/[momentId]/route.ts:82-116`,
  `private-media-delivery.ts:86-115`). The memory cache keeps 24 entries / 16 MB
  for 60 s.
- **Video:** every Range request runs proxy → delivery RPC → `createSignedUrl` →
  upstream range fetch (streamed). If storage answers 200 to a Range request, the
  route reads from byte 0 up to the requested range
  (`api/media/videos/[momentId]/route.ts:165-280`).
- **Poster:** same three-hop pattern as photos (`…/poster/route.ts:67-77`).
- There is no photo lightbox today; photos are inline only
  (`double-tap-photo.tsx:8`).

## 7. Everyday interactions (server work per tap)

| Action | Server path | Serial V↔S waves (today) | Full page renders |
| --- | --- | --- | --- |
| Heart | identity → `set_moment_reaction` → deliveries RPC → pushes (await, no timeout) | 3 + push | 0 (UI is optimistic) |
| Comment | identity → `create_moment_note` → deliveries → pushes; then `loadConversation` action: identity → `get_moment_conversation` | 5 + push | 0, but the UI waits for both actions |
| Written post | identity → `create_family_moment` → deliveries → pushes → `revalidatePath` → re-render in the action response; client also `router.replace` + `router.refresh()` | 3 + push + 3 renders | up to 3 |
| Edit | update RPC(s) → `revalidatePath`; client `router.replace(pathname)` + `router.refresh()` | 2–3 + 3 renders | up to 3 |
| Show earlier days (`pages=N`) | full navigation; opening and remainder each read N pages serially | ~2N + enrichment | 1 |
| Pull to refresh | `router.refresh()` | full route | 1 |
