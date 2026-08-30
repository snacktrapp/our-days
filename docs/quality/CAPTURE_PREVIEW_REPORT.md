# Capture-preview interaction evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: decision-independent, fixture-backed front-end contract. This checkpoint proves how capturing a moment should feel; it does not save, upload, mutate a timeline, or claim that production authorization and media handling exist.

## Product contract established

The Add Moment sheet offers four deliberately small workflows:

- **Photo** requires one browser-decodable image and permits an optional caption.
- **Thought** requires written text.
- **Milestone** requires a milestone name and permits optional detail.
- **Place** requires a manually entered place name and permits optional detail.

Every mode shares a plain calendar date, journal choice, optional people tags, and optional manual place. The frozen fixture date (`2026-08-28`) makes screenshots deterministic; production must derive the maximum local date from the circle's stored IANA timezone without converting an authoritative date-only value through a JavaScript timestamp.

Choosing review does not imply a save. The editor says that nothing will be uploaded or saved, review says that nothing was saved, and its terminal action is **Close preview**. Review shows the resulting moment, journal, date, people, place when it is not already the Place title, and truthful `Recorded by Brian` attribution for a managed-child journal. Back to edit preserves the entire in-memory draft.

The fixture intentionally lets Brian choose only his own journal and managed-child journals; Molly remains taggable but is not an authorship target. This is the recommended UI boundary only. It neither accepts PD-001 nor implements production guardian authorization. Production must consume an accepted decision and derive every allowed target on the server.

## Local photo/privacy boundary

- The browser accepts only a small explicit image MIME allowlist, a nonempty file, and at most 25 MiB before creating an object URL. The 25 MiB value is a preview guard, not the eventual production upload policy.
- A photo cannot reach review until the current object URL has decoded successfully. Load/error handlers are bound to the expected URL, so a delayed event from a replaced image cannot approve or revoke the current image.
- Object URLs are revoked on replacement, removal, accepted discard, type change, review completion, decode failure, and unmount. A canceled discard retains the live preview.
- The UI does not read or render `File.name`, `lastModified`, EXIF, GPS, or an inferred location. The native input is visually replaced by generic copy; place entry is manual.
- The selected file, text, and metadata remain component memory only. No `FileReader`, storage client, route mutation, Server Action, database call, analytics call, or persistence API exists in this slice.
- Local blob images deliberately use a native `<img>` instead of Next's public optimizer. Sending a private/local blob through a generic optimizer is the wrong ownership boundary, and Next's generated image style would violate the enforced no-inline-style CSP.

`img-src blob:` permits the local preview. Compiled Chromium also emitted a `connect-src` CSP violation for this React/blob rendering path without `connect-src blob:`, so that local-only scheme is explicitly allowed there as well. No HTTP(S) origin is added. Browser security tests require the image to render with no application style attribute and no page-health error.

## Interaction and accessibility evidence

- Native modal behavior, body-scroll locking, focus containment in both directions, Escape/backdrop dismissal, trigger-focus restoration, and sticky close behavior are browser-tested.
- The chooser, every visible control, and review actions meet the 44 CSS-pixel target contract; text-entry controls remain at least 16 CSS pixels.
- Thought, Photo, Milestone, and Place expose their distinct visible labels as accessible names.
- Whitespace-only required content stays in edit mode, receives a linked live error, and moves focus to the invalid field. A future date cannot reach review.
- Review moves programmatic focus to its heading so assistive technology receives the state change and the no-save context before the action controls.
- Axe reports no serious or critical findings in expanded capture states. Every capture and review control remains reachable in a 320×350 viewport.

Reviewed baselines cover the chooser, expanded Thought, Thought review, Photo edit, Photo review, Milestone edit, Place edit, Place review, and an exact 320×350 Place state. They are deterministic through explicit font and photo-decode waits and were individually inspected after generation.

## Adversarial browser proof

The capture privacy test starts after the compiled page and service worker are idle, then chooses a real photo whose filename contains a unique private marker and uses an HTML/script-shaped caption. It proves:

- zero HTTP(S) requests occur during choose/edit/review/close;
- the filename marker is absent from visible DOM text and the request inventory;
- the caption is rendered as text, creates no injected element, and executes no script;
- local/session storage, cookies, named IndexedDB databases, complete Cache Storage request inventories, URL, title, history length, and serialized history state are unchanged;
- instrumentation observes no IndexedDB open/delete or Cache Storage put/add/addAll/delete operation;
- the complete ordered timeline kind/text snapshot is unchanged;
- written and photo drafts disappear after reload.

The locked document and genuine RSC replay tests include every composer-only family-name canary. The production artifact scanner now covers tracked plus untracked non-ignored source, the complete build, browser-deliverable outputs, and 14 fixture canaries including Sam, June, and all five synthetic note bodies.

## Verification snapshot

- `npm run check`: formatting, ESLint, TypeScript, and 178 tests across 15 files passed.
- `npm run build:webpack`: production compilation and the redacting credential/private-fixture scan passed.
- `npm run test:e2e`: the atomic production build and scan passed, followed by 96 browser checks passed, 41 intentional project-specific skips, and no failures.
- The local Playwright inventory contains 137 checks across eight files; the prepared CI inventory contains 180 when WebKit is enabled.
- Focused compiled Chromium covered all modes, whitespace/future-date denial, no-network/no-persistence proof, axe, and 320×350 reachability. The complete composer visual suite and its short-screen case each passed five consecutive repeat runs after the final native-control stabilization.
- Independent UX/accessibility, privacy/adversarial, and test-gap reviewers each returned **GO** with no current-tree blocker. Their last nonblocking gaps—Cache Storage mutation instrumentation and review-image failure recovery—were added before the final matrix.

## Production gates deliberately deferred

- Invitation Auth, current membership, circle role, guardian, other-adult denial, revoked-member denial, and RLS evidence.
- Server-side validation, upload intent, checksum, MIME sniffing, malware handling, quotas, idempotency, and upload recovery.
- Private original storage, derivative generation with stripped metadata, signed/authenticated delivery, revocation, export, deletion, and purge jobs.
- Accepted production limits for image/video size, formats, duration, and retry behavior.
- Physical iPhone Safari/standalone, VoiceOver, large text, software keyboard, low-memory photo decoding, and hosted WebKit evidence.

These remain release-critical later-phase gates. No backend resource was created or connected by this checkpoint.
