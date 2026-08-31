# Phase 4B isolated validation and immutable-original promotion

Date: 2026-08-30

Status: **verified local security foundation — production photo handling remains unavailable**

This checkpoint closes one narrow integrity gap left by Phase 4A: a separately allowlisted validator can lease one uploaded quarantine object, validate a bounded local copy, promote the exact validated bytes to a fresh browser-unwritable canonical path, re-read that canonical object, and atomically record an immutable original. It still does not publish a photo moment or deliver family media.

## Implemented boundary

- Three forced-RLS private ledgers separate validator identities, validation jobs, and accepted originals. No browser, family member, anonymous client, or service role receives direct table access.
- A validator Auth identity must be explicitly allowlisted out of band, cannot simultaneously belong to a family circle, and is serialized against later membership attachment and validator revocation.
- Every claim has a hashed lease key, a bounded lease, a distinct Auth identity, a random lease-attempt identifier, and a fresh canonical path. An expired attempt cannot be reclaimed by the same validator identity. A stale attempt therefore loses both source-read and canonical-write authority when a different validator takes over.
- The validator downloads only the exact leased quarantine object, spools at most 50 MiB into an invocation-private `0700` directory and `0600` file, incrementally counts and SHA-256 hashes every byte, independently identifies the format, and forces bounded decoding.
- JPEG, PNG, and WebP are the only locally accepted formats. The JPEG parser proves that the first codestream EOI is the object boundary, so concatenated images and trailing polyglot bytes are rejected. HEIC and HEIF remain unsupported and unpublished.
- The already-open validated inode is rehashed before handoff. Its pathname is removed before trusted promotion code receives a read-only stream, and callback success requires full stream consumption.
- Canonical upload uses standard authenticated Storage upload without upsert to an attempt-specific path. Exact user metadata includes the job, intake, original, lease attempt, expected fingerprint, and validator-profile version.
- The validator re-downloads the canonical object and rechecks its complete byte count and SHA-256 before completion. PostgreSQL then verifies the exact Storage row identity, version, metadata, active lease, current validator permission, requester authority, and expected fingerprint before inserting one immutable original.
- A late TUS completion can mutate only quarantine. It cannot change the private spool, the current attempt-specific canonical path, or a recorded original.
- Rejections and ambiguous canonical collisions are terminal and auditable. They do not create an original or a moment.

## Authorization and race controls

- Validator allowlisting rejects an existing family account, and membership attachment rejects an active validator identity. Both directions serialize on the Auth identity.
- Claim, completion, rejection, and operator-review coordinators lock and recheck the allowlist row. Revocation and coordinator work therefore have one database serialization point; a coordinator cannot commit after a revocation that won first.
- Reclaim requires a different allowlisted, no-family Auth identity and creates a new random attempt capability and canonical path. The previous identity and path do not regain authorization merely because a later lease is active.
- Lock order is validator identity and allowlist, then circle, requesting membership, intake, and job. Authority is rechecked inside the same transaction before terminal state changes.
- Storage policies admit only the reviewed normalized operation names: exact authenticated source GET/info and exact canonical standard upload/GET/info. List, signed URL, public URL, update, delete, copy, move, upsert, TUS to originals, and every family-browser media operation remain denied.

## Local validation evidence

All exercised bytes are synthetic. No hosted project, production credential, or personal family media is used.

- Focused byte-validator contracts cover size/hash/MIME mismatch, complete decode limits, exact JPEG/PNG/WebP endings, concatenated/trailing JPEG rejection, stalled input deadlines, random chunking, private-spool cleanup, full handoff consumption, and escaped-stream denial.
- Focused and full pgTAP suites pin table/routine/trigger catalogs, exact ACLs and policies, family/validator identity separation, lease ownership and reclamation, revocation behavior, nullable argument denial, requester-authority loss, immutable original consistency, and zero-publication outcomes.
- The real local Storage journey proves exact quarantine read, bounded validation, exact-byte no-upsert canonical upload, canonical read-back, atomic completion, duplicate denial, late-quarantine-write isolation, and post-completion browser/validator denial.
- The concurrency journey preserves Phase 4A's distinct-TUS-URL overwrite finding and adds validator-revocation serialization evidence.
- Generated public TypeScript types, schema lint, two clean resets, the logical restore drill, the broader Auth/database concurrency checks, the production webpack build, and the private-artifact scan remain release gates for this checkpoint.

## Deliberate non-capabilities

Phase 4B still provides none of the following:

- no production or hosted validator deployment;
- no permission to use personal family photos;
- no photo moment, display derivative, thumbnail, browser media read, signed URL, download UI, export entry, or deletion workflow;
- no HEIC/HEIF acceptance, genuine iPhone fixture evidence, or photo-picker evidence;
- no promise that database backup restores Storage bytes;
- no quarantine/orphan/collision cleanup policy before PD-005; and
- no display delivery/cache/revocation architecture before PD-006.

Originals remain untrusted opaque files. A later download path must use a safe attachment disposition and `nosniff`; family display must use a separately transcoded, orientation-correct, metadata-stripped derivative.

## Production gates

1. Resolve PD-005 for quarantine, orphan, collision, trash, and hard-purge behavior.
2. Resolve PD-006 for authenticated derivative delivery and cache lifetime.
3. Build the validator as an immutable, sole-tenant Linux artifact with network egress restriction, short-lived credentials, OS CPU/memory/time limits, bounded concurrency, runtime codec-version assertions, and whole-invocation cancellation covering download, spool, metadata, decode, upload, and canonical read-back.
4. Test large and malicious fixtures, genuine iPhone HEIC/HEIF photos, EXIF orientation, progressive and CMYK JPEG, animated/multi-page formats, interruption, retry, lease expiry, revocation, and mismatched canonical collision in the hosted artifact.
5. Produce metadata-stripped derivatives and prove EXIF/GPS absence, authenticated delivery, cache/revocation behavior, original download safety, export/deletion reconciliation, and encrypted media-byte recovery.
6. Complete a quarantined hosted rehearsal and a fresh independent privacy/security review before enabling personal media.

The Storage policy design follows Supabase's private-bucket RLS model and helper-function guidance: [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [schema helper functions](https://supabase.com/docs/guides/storage/schema/helper-functions), and [standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads). Decode behavior and production isolation assumptions follow Sharp's [constructor](https://sharp.pixelplumbing.com/api-constructor/) and [security](https://sharp.pixelplumbing.com/security/) guidance.
