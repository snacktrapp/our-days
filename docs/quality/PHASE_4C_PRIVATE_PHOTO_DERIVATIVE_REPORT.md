# Phase 4C private photo display derivatives

Date: 2026-08-31

Status: **verified local security foundation — family photo display and production photo handling remain unavailable**

This checkpoint turns one immutable Phase 4B original into one bounded, metadata-stripped display WebP inside the existing isolated validator boundary. It proves transformation and private publication integrity with synthetic local bytes. It does not publish a photo moment or give a family browser any media access.

## Implemented boundary

- Each immutable original creates one forced-RLS derivative job. The job preserves the original, circle, requesting membership, derivative identity, transform profile, and exact immutable source Storage identity/version.
- A separately allowlisted, no-family validator receives a 15-minute lease, random lease-attempt identity, and fresh `display/<derivative>/<attempt>.webp` path. An expired attempt can move only to a different validator identity.
- The source is downloaded through an exact active-lease Storage policy and completely revalidated against the immutable original fingerprint and decoded geometry before transformation.
- The streaming Sharp transform applies EXIF orientation, never enlarges the source, limits the longest edge to 2560 pixels, converts to sRGB, preserves supported alpha, and writes a single-page WebP capped at 12 MiB.
- The derivative spool uses an invocation-private `0700` directory and `0600` file. The implementation verifies the opened writer/reader device and inode, rehashes the complete file, permits only the reviewed WebP RIFF chunks, rejects animation and metadata chunks, removes the pathname before handoff, and requires the upload callback to consume the stream completely.
- The private display bucket now accepts only `image/webp` and caps objects at 12 MiB. Upload is no-upsert and exact-path only. Immutable user metadata binds the job, source Storage identity/version, lease attempt, output checksum, byte count, geometry, page count, and transform profile.
- After upload, the validator downloads the canonical object again, recounts and rehashes every byte, fully decodes it, rechecks geometry and forbidden metadata, and repeats strict RIFF parsing. Only then can the database coordinator bind the exact Storage row identity/version and output evidence into one immutable derivative ledger row.
- Completion, rejection, operator review, requester-authority invalidation, and validator revocation are terminal or serialized. No derivative path becomes readable after the lease ends or the job leaves `leased`.

## Adversarial fixes incorporated

- Strict source parsing was extended after review showed that Sharp's single-page mode can flatten a valid APNG without proving the source is non-animated. PNG chunk order, CRCs, critical-chunk names, animation chunks, and the exact IEND boundary are now checked independently.
- WebP sources must have an exact top-level RIFF size, a reviewed initial chunk marker, and a successful bounded full decode with one page. Canonical WebP output additionally uses a strict inner-chunk allowlist that rejects animation, metadata, unknown/high-bit chunk aliases, invalid padding or sizes, trailing bytes, and inconsistent VP8X canvas/feature declarations.
- The display bucket was narrowed from the original placeholder 50 MiB/no-MIME profile to the actual 12 MiB WebP transform contract.
- Database completion initially trusted validator-supplied output checksum and geometry. The final contract binds those claims into the immutable Storage row metadata at upload authorization and compares them again during completion; malformed or out-of-range JSON metadata fails safely.
- The real Storage harness caught an obsolete JPEG canary for the now-WebP-only display bucket. The canary now matches each protected bucket's reviewed MIME contract.

## Local evidence

All exercised media is generated synthetic data. No hosted project, production credential, or family media is used.

- Forty-eight focused transform/source-validator contracts pass. They include all eight asymmetric EXIF orientations; JPEG, PNG, WebP, alpha, CMYK, GPS/XMP/ICC stripping, fixed v1 geometry, no enlargement, exact chunking, stalled-input deadlines, full-consumption enforcement, private-spool lifecycle, canonical re-download, and a recomputed-hash matrix for metadata, animation, high-bit/unknown chunks, padding, trailers, duplicate/misordered image chunks, and VP8X feature/canvas inconsistencies.
- The focused derivative and exact identity/authorization pgTAP suites pass 126 assertions after a clean migration replay; the complete database suite passes 848 assertions across 15 files. They pin forced RLS, ACL/function catalogs, fixed profile geometry, nullable and malformed/overflowing metadata denial, exact source path/identity/version and claim evidence, immutable completion, requester and validator revocation, stale attempts, distinct-validator takeover, terminal review idempotency/audit/closure, and zero photo-moment publication.
- The real local Auth/Storage journey passes exact original revalidation, wrong-MIME and oversize display upload denial, no-upsert canonical upload, duplicate denial, full canonical read-back, immutable completion, family/wrong-circle/revoked/anonymous denial, and post-completion source/display closure.
- The overlapping derivative race harness proves that validator revocation and requester revocation each hold the serialization lock while completion visibly waits, then commit first and prevent all publication. It also proves stale source-read denial, same-validator reclaim denial, a fresh distinct-validator attempt/path, and exactly one successful ledger/audit publication from only that fresh attempt.
- The complete Vitest suite passes 546 tests across 46 files. The local logical-recovery drill was refreshed to pin the Phase 4C migration head, private display-bucket profile, empty derivative ledgers, routine authorization, Storage denial, ACL boundary, and exact schema/data/archive fingerprints; two clean full dump-and-restore rehearsals passed with fidelity, authorization, cleanup, and static fail-closed checks.
- The production webpack build, private-artifact scan, and complete local mobile/visual Playwright matrix pass; the browser matrix has 161 applicable passes and 55 intentional project/viewport skips. The connected invitation-to-journal regression also passes in Chromium and Firefox against the final schema. The local WebKit executable crashes at launch on this host before reaching the app, so WebKit remains a hosted CI and real-device gate rather than a claimed local pass.
- Independent transform, database, test-gap, and final security reviewers found the APNG, bucket-profile, output-evidence, and transform-profile issues described above. The confirmed defects and evidence gaps were fixed and re-tested; the final static review found no remaining authorization or privacy bypass.

## Deliberate non-capabilities

Phase 4C provides none of the following:

- no photo moment or combined/personal timeline publication;
- no family, organizer, browser, public, or signed-URL read of originals or derivatives;
- no original download UI, export inclusion, deletion/purge worker, orphan cleanup promise, or media-byte recovery;
- no hosted validator, production credential, network/process sandbox, or production-data approval;
- no HEIC/HEIF acceptance or genuine iPhone photo/picker evidence; and
- no decision on PD-005 cleanup/retention or PD-006 delivery/cache/revocation semantics.

## Production gates

1. Resolve PD-005 before promising quarantine, orphan, collision, derivative, trash, or hard-purge behavior.
2. Resolve PD-006 before granting any family delivery capability or choosing a cache/signed-URL lifetime.
3. Build and review a sole-tenant Linux validator artifact with restricted egress, short-lived credentials, OS CPU/memory/time limits, bounded concurrency, whole-invocation cancellation, and pinned runtime/codec assertions.
4. Re-run malicious and maximum-size fixtures plus genuine iPhone HEIC/HEIF, color-profile, orientation, interruption, lease-expiry, revocation, collision, cleanup, and device-picker tests in that hosted artifact.
5. Prove authenticated family delivery, immediate database revocation plus any approved residual URL lifetime, safe original downloads, export/deletion reconciliation, and encrypted media-byte recovery.
6. Complete a quarantined hosted rehearsal and fresh independent privacy/security review before enabling personal media.
