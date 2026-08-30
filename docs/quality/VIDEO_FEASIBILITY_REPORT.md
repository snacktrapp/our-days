# Short-video feasibility evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: decision-independent local feasibility spike. This checkpoint does not accept PD-004, add Video to Add Moment, upload or save a clip, create a video moment, or claim that production media ownership is solved.

## Question this spike answers

Can a short family clip enter the center-line timeline without making Our Days feel like a conventional social feed, and can the browser inspect and preview that clip locally without disclosing it?

The isolated `/quality/video-feasibility` route presents one synthetic video moment attached to the existing timeline rail. Its dark, still media mat, restrained play symbol, and ordinary card copy treat motion as another memory type rather than an engagement surface. The route labels itself **Quality-only preview**, the card says **A possibility, not a promise**, and the timeline ends at **Decision still pending**.

Video is intentionally absent from the normal Add Moment chooser. Passing this checkpoint means only that the product treatment and local browser lifecycle are plausible. PD-004 remains pending, and production video remains outside the MVP until the upload, derivative, delivery, export, deletion, and real-device gates below pass.

## Local inspection contract

The native file input accepts `video/*`; the component then applies a provisional local guard before previewing:

- one nonempty MP4, MOV, M4V, or WebM file;
- at most 100 MiB;
- finite positive duration, about 60 seconds or less (`60.5` seconds permits normal recorder rounding);
- positive video dimensions totaling at most 9,000,000 pixels, roughly a 4K frame ceiling;
- both readable metadata and one decoded data frame within 15 seconds.

After five seconds the UI says inspection is still happening. At 15 seconds it rejects the file and returns focus to the picker. These values are spike limits only, not accepted production policy.

Playback uses native controls with `playsInline` and metadata preload. It does not autoplay. Picture-in-picture, remote playback, and a download control are suppressed where the browser supports those hints. The media remains letterboxed with `object-fit: contain` rather than being cropped.

The real-browser success path uses `tests/fixtures/synthetic-short.mp4`: a 10.9 KiB, one-second, 160×90 H.264 color field with no audio or personal content. It was generated locally with Apple's `AVAssetWriter`, was not downloaded, and lives under `tests/` rather than `public/`. SHA-256: `ff6292b15dd41320e7a674890e8e7968eb0adbdf5d2a5767899f11d29699014e`.

## Privacy and lifecycle proof

- The selected `File` receives one temporary browser-local object URL only after type and size validation.
- The blob URL is paused, detached from the media element, and revoked on replacement, removal, rejection, accepted discard, close, timeout, or unmount. Stale media events cannot approve or revoke a newer selection.
- The picker filename is never rendered or logged. The component reads only the declared type, byte size, local extension fallback, duration, and dimensions; it does not read `lastModified`, EXIF, GPS, or additional sensitive container metadata.
- No `FileReader`, upload client, route mutation, Server Action, database call, analytics call, local/session storage write, IndexedDB write, Cache Storage write, or history mutation exists in the spike.
- Closing or reloading forgets the selection. Closing with an active selection requires explicit discard confirmation; canceling preserves the local preview.
- The route performs the fail-closed design-preview guard before constructing fixture-backed chrome. Its document is private/no-store/noindex, and the preview-disabled route redirects without returning private fixture strings.
- Production compilation initially failed the private-artifact scan because the client component contained a fixture family name. The name was replaced with the neutral identity **You**; the scanner was not weakened, and the rebuilt browser bundle passes.

The compiled adversarial browser test selects a corrupt video whose filename contains a unique private marker. It proves local rejection with the marker absent from DOM and request inventories, zero HTTP(S) interaction requests, unchanged URL/history/cookies/local storage/session storage/named IndexedDB databases/cache names, no observed IndexedDB open/delete, no observed Cache Storage put/add/addAll/delete, and an empty state after reload.

## Interaction, mobile, and accessibility evidence

- The native modal sheet locks background scrolling, contains focus in both directions, supports Escape and backdrop dismissal, and restores focus to the trigger.
- Dismissal with a selected clip distinguishes cancel from accepted discard.
- Error and progress copy are announced, invalid selection returns focus to the picker, and the no-upload/no-save boundary labels the dialog.
- Chromium and Firefox show no serious or critical axe finding in the route/dialog flow.
- The route has no horizontal overflow or visible target below 44 CSS pixels at 390×844 or 320×568.
- At an exact 320×350 keyboard-sized viewport, the picker and terminal close action remain scroll-reachable; the dialog stays within the viewport.
- Reduced-motion preference removes the sheet entrance animation.
- The normal Add Moment chooser is browser-asserted not to contain a Short video option.
- The synthetic clip reaches a decoded current frame with positive duration and dimensions, then playback time advances in compiled Chromium and Firefox. The ready/player state also passes the exact 320×350 reachability and axe checks.

The pinned Chromium baselines are:

| Screenshot                                                            | SHA-256                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `video-feasibility-chromium-mobile-chromium-mobile-darwin.png`        | `116838b1b8c881ad316070342c3dfb74a66a8667010ef625668f0f2f1d95cb13` |
| `video-feasibility-dialog-chromium-mobile-chromium-mobile-darwin.png` | `42db4a5cdff472c785d80846b6e34297114410ea63ebf32f4d4cd5c8ebee7f49` |

The hashes above must be recalculated if an independent-review fix intentionally changes the images.

## Current platform implications

This research informs the later production spike; it is not an implementation commitment:

- Supabase recommends standard uploads only for small files and its resumable TUS path for larger files or unstable networks. TUS upload URLs can remain valid for up to 24 hours, so production must disable default client fingerprint persistence or prove that any resume identifier is opaque and account-scoped. [Standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- Vercel Functions impose a 4.5 MiB request/response body limit. Video bytes therefore must not transit the ordinary web Function; a production design would reserve an authorized asset and upload directly to private storage. [Vercel Function limits](https://vercel.com/docs/functions/limitations), [body-size guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- Supabase private buckets still depend on RLS for object access. Signed URLs are bearer capabilities until expiry, and CDN caching can outlive a token's nominal expiry. Production needs a deliberate delivery/revocation decision rather than assuming “private bucket” solves playback. [Private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [serving downloads](https://supabase.com/docs/guides/storage/serving/downloads), [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- Apple recommends standards-based native video delivery and broad Safari compatibility still favors H.264 MP4. `playsinline` is necessary for the intended installed-iPhone behavior. [Apple Safari video guidance](https://developer.apple.com/documentation/webkit/delivering-video-content-for-safari)
- HTML Media Capture permits the simple file-input approach, but recorded media may contain sensitive metadata such as location. Local preview does not sanitize the original; production must preserve the immutable original privately and generate stripped display assets. [W3C HTML Media Capture](https://www.w3.org/TR/html-media-capture/)

## Production work deliberately deferred

No production upload path should be built until PD-004 is accepted. If accepted, the next measured spike must prove:

1. An RLS-authorized, circle-scoped reserved asset row and resumable direct upload that cannot spoof another path, circle, owner, or media type.
2. Resume/retry behavior across foreground, background, interrupted network, expired TUS URL, duplicate completion, and revoked membership, without leaking filenames or upload fingerprints across accounts.
3. Immutable original bytes and checksum; container/MIME sniffing; quarantine or malformed-codec handling; quota and decompression/transcode exhaustion limits.
4. An isolated, idempotent worker that produces orientation-correct, metadata-stripped playback derivatives and posters without trusting caller-supplied identity or paths.
5. A deliberate codec/container matrix, iPhone recording matrix, Range-request behavior, controlled signed or authenticated playback, bearer/cache expiry, and revoked-member denial.
6. Export of original plus manifest/checksum, trash/restore, partial-failure retry, and verified purge of original, derivatives, posters, resumable state, cache, and export copies.
7. Physical current iPhone Safari and installed-PWA checks for picker behavior, 4K/HDR/HEVC input, rotation, low memory, thermal pressure, large text, VoiceOver, software keyboard, background/foreground, and poor connectivity.

## Ship, defer, and stop rules

- **Ship a capped feature only if** the production spike satisfies the same authorization, ownership, retry, export, deletion, and real-device bar as photos, and Brian explicitly accepts PD-004.
- **Defer video** if direct upload is reliable but transcoding, playback compatibility, revocation, or export/purge cannot meet that bar without disproportionate complexity.
- **Stop the branch** if it requires family video bytes to pass through the ordinary Vercel web Function, exposes a public object path, relies on client validation for authorization, persists a resumable upload identity across accounts, or cannot guarantee original ownership and eventual purge.

## Verification snapshot

- `npm run check`: formatting, ESLint, TypeScript, and 194 tests across 17 files passed.
- `npm run build:webpack`: production compilation and the private-artifact scan passed after the scanner caught and drove removal of the client fixture name.
- Focused video matrix: seven applicable checks passed across Chromium mobile, Firefox mobile, and Chromium short; two duplicate mutation audits were intentionally skipped. Both engines decode and advance the synthetic H.264 clip; the Chromium-only audit proves the same successful path plus corrupt-file rejection causes no HTTP(S), browser-persistence, cache, history, or filename disclosure.
- Affected navigation/mobile/privacy matrix: 56 passed and four intentional project-specific skips.
- `npm run test:e2e`: fresh production build and artifact scan passed, then the complete local matrix passed 149 checks with 55 intentional project-specific skips and zero failures. The local inventory is 204 checks across 11 files; enabling the prepared WebKit project produces a 268-check CI inventory.
- Two deterministic visual baselines were generated and individually inspected.

Independent UX/mobile, privacy/adversarial, and test-gap re-reviewers each returned **GO** with no current-tree blocker. Physical iPhone, hosted WebKit, and all production media gates remain explicitly open. No Supabase, Vercel, GitHub, email, media, or other external resource was created or connected.
