# Phase 4A fingerprint-bound photo-intake foundation

Date: 2026-08-30

Status: **verified local security foundation — production photo handling remains unavailable**

This checkpoint addresses one narrow boundary: a currently authorized family member can reserve an opaque quarantine path, commit the expected identity of one photo, transfer bytes directly to private Storage with authenticated TUS, and acknowledge only that an unverified object exists. It does not deliver a photo feature and it does not establish a physical single-write guarantee.

## Implemented boundary

- A private, forced-RLS `photo_intakes` ledger binds one request to its circle, journal person, requesting membership, authorization version, and server-generated `intake/<uuid>` path.
- Reservation does not authorize Storage. The client must call `claim_photo_intake_upload` with a distinct idempotency key and a lowercase 64-hex SHA-256, allowed lowercase MIME type, and byte count from 1 through 52,428,800. A successful claim opens a bounded two-hour upload window.
- The third private bucket, `our-days-intake`, retains the reviewed image MIME allowlist and 50 MiB limit. Bucket declarations and client claims are intake defenses, not content verification.
- The only browser Storage operations are authenticated `storage.tus.upload.create` and `storage.tus.upload.part` for the exact current claimed path and owner. Standard upload, signed upload, upsert, S3 upload, read/list, update, and delete are outside the contract.
- TUS transfers go directly from the browser to Supabase Storage with the member's ordinary JWT. Original-quality photos do not traverse the Vercel web process because Vercel's 4.5 MiB request-body limit is incompatible with the 50 MiB intake ceiling.
- Acknowledgement rechecks current authority and the exact Auth-owned Storage row. Its terminal success state is `uploaded_unverified`; Storage-observed MIME and size remain untrusted observations.
- Reservation, claim, Storage authorization, and acknowledgement recheck current membership, Auth attachment, account closure, and effective authority over the journal. Relevant authority loss invalidates open intake. Role-only changes preserve self-journal work, and an explicit guardian grant continues to authorize a managed child's intake after organizer demotion, as required by ADR-036.

## Concurrency finding and safety consequence

Supabase's published TUS guidance says that different upload URLs targeting one path should produce one successful completion and one conflict. The pinned local Storage behavior did not uphold that statement under an overlapping race: both final PATCH requests completed successfully and one completed payload became the object at the path. By contrast, two simultaneous offset-zero PATCH requests to the same upload URL deterministically produced one completion and one safe denial. Both exact outcomes are pinned so a Storage-image change forces review rather than silently changing the threat model.

The database claim therefore binds one logical expected file but does not prove that Storage accepted only one physical write. This is an explicit design constraint, not a residual assertion hidden behind the word “upload.”

Consequently:

- quarantine bytes are never a moment, accepted original, derivative source, download, or export source;
- `uploaded_unverified` never means verified, preserved, safe, immutable, or publishable;
- the fingerprint claim detects whether the bytes later selected for promotion match the intended file, but it does not prevent temporary same-path overwrite or storage-cost abuse; and
- a late completion after authority closes may change only an untrusted quarantine object and must be reconciled and swept.

## Required immutable-promotion boundary

Before any photo can become family content, a separately deployed, narrowly privileged validator must:

1. atomically close browser upload authority for the intake;
2. service-download the current versioned quarantine object without exposing it to the web app or browser;
3. count and incrementally SHA-256 the complete bytes, identify the real format, and successfully decode it within bounded resource limits;
4. reject or terminalize any mismatch against the committed hash, size, or allowed content type;
5. copy the exact verified bytes to a fresh canonical path in a private boundary with no browser write policy;
6. durably bind publication to that immutable canonical object, never the quarantine path; and
7. reconcile retry/crash cases and sweep every superseded, late, rejected, expired, or orphaned quarantine version.

Closing upload authority alone is insufficient. A TUS PATCH that passed authorization just before closure can finish later through Storage's privileged completion path. Copying the verified bytes to a fresh browser-unwritable canonical path is what prevents that late write from changing published family content.

## Verification evidence

All tests use synthetic local data. No hosted project, production credential, or personal media was used.

- The focused photo pgTAP suite passes 115 assertions. The full database suite passes 618 assertions across 12 files, including exact grants/policies, replay/conflict/expiry, monotonic state, wrong-circle and authority-loss cases, role-continuity cases, and the absence of a publication reference.
- The static photo and CI contracts pass 14 assertions. The complete unit/component/contract suite passes 488 assertions across 43 files; formatting, ESLint, TypeScript, and the recovery self-test also pass.
- The real HTTP integration suite proves claim-before-upload, exact metadata/path/owner binding, `x-upsert:true` denial, denial of standard/signed/read/list/update/delete/copy/move routes, safe non-5xx denial responses, truthful `uploaded_unverified` acknowledgement, byte retention, and exact synthetic-object cleanup.
- The forced concurrency suite proves one immutable fingerprint-claim winner; one same-URL TUS completion; the pinned two-completion distinct-URL hazard; quarantine-only acknowledgement; and safe serialization against membership, guardian, and closure authority loss. The preparation case is intentionally described as a stale-PATCH denial after closure request, not as evidence of a still-authorized preparation race.
- Generated database types match the reset schema. The existing Auth integration and broader database concurrency suites remain green.
- A production webpack build and private-artifact scan pass. The complete connected family journey passes in Chromium and Firefox. Local WebKit cannot launch on this macOS 14 host: Playwright identifies its macOS 14 WebKit build as frozen, and a forced clean reinstall still exits with a pre-page bus error. The macOS 15 Intel CI WebKit gate remains required; this local environment result is not represented as app-level WebKit evidence.
- The isolated logical restore completed successfully while recapturing the reviewed schema, catalog, normalized-data, archive, and restored-schema fingerprints. The clean-source rerun then exposed two reset-generated platform migration timestamps that had been incorrectly treated as stable data. The drill now narrowly normalizes only those timestamp columns while continuing to pin migration IDs, names, hashes, and versions; the normalized digest remained identical across two clean resets, and the complete isolated restore passes with the corrected pin.

The remaining production gates below are intentionally outside this foundation. Passing this checkpoint does not make photo posting available.

## Explicit non-capabilities

Phase 4A provides none of the following:

- no personal family data and no approval to use production data;
- no hosted or production deployment;
- no browser read, list, preview, download, or media URL;
- no standard, signed, upsert, or S3-compatible upload path;
- no verified content, accepted original, canonical copy, derivative, or photo moment;
- no orientation correction, EXIF/GPS stripping, delivery URL, CDN/cache policy, or iPhone rendering proof;
- no deployed validator, durable media job, quarantine sweep, orphan reconciliation, export, purge, or account-closure media reconciliation; and
- no backup or recovery of Storage bytes. The logical recovery drill covers bucket and database metadata only.

## Remaining production gates

1. Brian's PD-006 decision before choosing derivative delivery lifetime versus an authenticated proxy.
2. Brian's PD-005 decision before choosing quarantine/orphan retention, trash duration, hard purge, and immediate-deletion authority.
3. Validator isolation, service-secret custody, bounded streaming/hash/decode behavior, job leases, retry, mismatch, late-write, immutable-copy, and cleanup evidence.
4. Byte-for-byte canonical-original and SHA-256 proof; EXIF/GPS removal from display derivatives; cache/revocation, export/deletion reconciliation, and authenticated encrypted media recovery.
5. HEIC/large-photo and interrupted/resumed TUS testing on supported iPhones.
6. A quarantined hosted rehearsal and independent privacy/security review before any personal family media is accepted.

PD-004 remains a separate pending video decision. Nothing in this photo-only intake checkpoint approves or implements video.
