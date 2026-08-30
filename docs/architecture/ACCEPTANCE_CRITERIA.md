# Release acceptance criteria

These are release requirements. Each becomes an executable gate when its owning phase adds the named command and test-file mapping below; no phase may claim the criterion before that evidence exists.

## Privacy and tenancy

- Anonymous and authenticated users with no active membership receive zero family rows and cannot mutate any exposed table.
- Every circle-owned row carries `circle_id`; composite constraints reject valid IDs mixed across circles.
- A user who is organizer in circle B but only a member in circle A cannot perform organizer actions in A.
- A captured live JWT loses all A database access and every newly authorized A media request immediately after A membership revocation while any valid B access remains intact. If PD-006 is approved, a pre-issued derivative URL has only the documented residual lifetime and cache cannot extend it; originals remain immediately membership-gated.
- Normal server routes use a new caller-scoped Supabase client per request; browser clients are unprivileged and caller-scoped. No module-scoped user client or broad service client handles routine requests.
- Client bundles, source maps, logs, analytics, and audit rows contain no secret keys, invite tokens, bodies, coordinates, filenames, or media URLs.

## Session, response, and input safety

- Protected routes are request-rendered and return `Cache-Control: private, no-store`, `Pragma: no-cache`, and an expired `Expires`; they never use ISR or public CDN caching.
- `src/proxy.ts` may refresh cookies and make optimistic `getClaims` checks, but every protected read/write still proves current membership through RLS. Refresh responses preserve all required `Set-Cookie` and private-cache headers.
- Two isolated browsers prove that user B never receives user A's cookie, RSC payload, prefetch response, names, or timeline after refresh, sign-out, or account switch.
- A nonce CSP narrowly allowlists scripts, connections, images/media, workers, forms, frames, and base URLs; injected script and CSP-violation tests fail closed.
- Every Server Action and Route Handler validates identity, active membership, operation authority, and typed input internally. Cross-origin mutations, hostile direct action calls, caller-controlled redirects, and non-allowlisted Auth redirects are denied.

## Invitations and roles

- Ordinary OTP/sign-in cannot create an account; only a trusted invitation flow can create/reactivate membership.
- Invitation records store hashes, expire, bind to the normalized verified email and circle, accept once atomically, and use generic denial messages.
- Two concurrent acceptances yield one membership and one success.
- Role/removal transactions cannot leave a circle without an active organizer.

## Timeline correctness

- A moment belongs to one journal person, preserves its recorder, and appears in both the authorized personal and combined feeds.
- Sorting and cursor pagination use occurrence fields plus `id`; equal timestamps never duplicate or skip a moment.
- A backdated moment appears at its true historical point; date-only memories do not shift across timezones.
- Loading older moments does not jump the viewport; view switching and browser back/forward have an intentional tested scroll policy.
- Loading, empty, slow, error, permission-lost, and end states retain the visual rail and explain the state.

## Media ownership

- Buckets are private. Public/anonymous URLs, object listing, guessed paths, overwrite/upsert of originals, and browser-side signed-URL creation are denied.
- An original remains byte-identical to upload and matches its SHA-256; display derivatives are orientation-correct and contain no EXIF/GPS.
- A media request proves active circle membership. Authenticated responses use reviewed private/no-store behavior and never enter a generic public Next optimizer cache.
- Interrupted upload completion is idempotent: exactly one moment and one original result.
- URL expiry, access denial, decode failure, and unavailable media have distinct stable UI states with reserved aspect ratio.

## Installed iPhone PWA

- Manifest has stable ID/scope, standalone mode, 192/512 and maskable icons, and a dedicated Apple touch icon.
- The header clears the notch/Dynamic Island; bottom-nav paint extends through the home indicator while controls remain above it.
- The composer traps focus, restores it, closes with Escape/Close, makes the background inert, locks background scroll, and confirms dismissal of a non-empty draft.
- The composer remains scrollable with Save and focused fields reachable on the smallest supported iPhone with keyboard/predictive text visible; inputs are at least 16px.
- All targets are at least 44×44 CSS pixels, normal text is at least 4.5:1, focus is visible, color is not the sole cue, and the UI works at 200% zoom and large iOS text.
- Reduced motion disables sheet/card entrance motion.

## Offline and cache safety

- A service worker caches only an explicit versioned public shell allowlist.
- It never caches authenticated HTML, APIs, locations, comments, timelines, drafts, originals, derivatives, or signed URLs.
- Sign-out clears account-scoped browser state, object URLs, Cache Storage, and IndexedDB.
- Offline launch after sign-out shows a locked/offline screen; switching accounts never reveals the previous account's names, thumbnails, drafts, or timeline.

## Deletion, export, and recovery

- Trash immediately hides the moment and every descendant from normal reads; restore authority matches the approved author/guardian policy.
- Browsers cannot hard-delete. The worker purge is idempotent and retains a tombstone until database rows and every object are confirmed removed.
- Export contains only the requested circle, includes structured records and unchanged originals, uses generated safe archive paths, and has count/checksum verification.
- Revoking an export requester denies or purges any ready download.
- Circle removal is membership revocation, not Auth-account deletion. Account deletion preserves authorized family history/attribution, does not cascade family moments, and deletes or deliberately reassigns user-owned Storage objects before the Auth user is removed.
- A documented restore drill proves the database and media recovery path before production family data is accepted.

## Environment isolation

- Local, Preview, and Production declare an environment identity and expected Supabase project reference; a mismatch, Preview→Production reference, or any Proof resource reference fails startup/build.
- Production secrets are scoped only to Production. Preview uses synthetic staging/local data and is protected by Vercel Deployment Protection until application auth is proven.
- The production site URL is a validated HTTPS origin, and Auth/redirect allowlists contain exact approved origins without wildcards or caller-controlled destinations.
- The ordinary web deployment contains no Supabase secret/service-role credential; built bundles, traces, and source maps are scanned for bypass credentials.

## Automated merge/release gates

Every PR runs all checks introduced by the current phase, and later phases cannot remove or weaken an earlier gate:

| Activated in | Required thereafter |
| --- | --- |
| Phase 0 | lint, typecheck, default production build in unrestricted CI, dependency audit, browser/error smoke, and clean visual evidence |
| Phase 1 | formatting check, unit/component tests, Chromium/WebKit/Firefox E2E, axe smoke, and visual regression |
| Phase 2 | RLS/grant/function/catalog pgTAP tests, invite/auth integration tests, cached-session/two-browser isolation, CSP/CSRF/direct-action tests, stale-token and wrong-circle denial suite, environment-boundary checks, and secret scan |
| Phase 4 | Storage HTTP policy tests, private-cache inspection, media retry/idempotency, checksum, and EXIF tests |
| Phase 7 | export/deletion/worker partial-failure and recovery tests |

- Release candidate: real current iPhone Safari and installed PWA, short-screen iPhone current/previous supported iOS, Dynamic-Island iPhone, Android installed PWA, and VoiceOver checks.
- The release fails on serious accessibility findings, console errors, unexpected failed requests, private-cache findings, duplicate/omitted timeline rows, secret findings, or any cross-circle/revoked-member access.
