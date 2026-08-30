# Privacy threat model

## Protected assets

- Family relationships and membership state
- Children's and adults' journal content
- Original photos/videos and their hidden metadata
- Precise or approximate locations
- Comments, reactions, dates, and attribution
- Invitations, sessions, exports, deletion requests, and audit history

## Trust boundaries

The browser and every request parameter are untrusted. Supabase Auth establishes identity, but an authenticated identity has no journal access without a current active circle membership. Postgres constraints plus RLS establish tenant and operation authorization. Storage access additionally resolves the exact asset metadata. Worker/service credentials are a total bypass and therefore live only in a separately deployed narrow worker, never the ordinary web-app environment.

## Principal adversaries and failures

1. Signed-out stranger or bot calls public endpoints and guesses IDs.
2. Authenticated user has no family membership.
3. Member of another family guesses valid identifiers.
4. Dual-circle user exploits a global role or mixes IDs from two valid circles.
5. Removed member reuses a still-valid access token or captured media URL.
6. Ordinary member forges organizer, author, guardian, or worker fields.
7. Invite recipient replays, races, forwards, or changes the email/circle on an invitation.
8. Browser bundle, source map, log, analytics tool, or error report leaks a credential or family detail.
9. CDN, image optimizer, service worker, browser cache, or offline store reveals family content after sign-out/account switch.
10. Media upload spoofs paths, overwrites originals, duplicates completion, embeds GPS, or fails halfway.
11. Soft-deleted parent hides incompletely while comments/reactions/media remain queryable.
12. Export archive crosses circles, traverses paths, remains downloadable after revocation, or loses originals.
13. Purge partially fails between Postgres and Storage and falsely reports deletion.
14. Concurrent role changes remove the last organizer.
15. A server-only secret is leaked or an overpowered worker trusts caller-supplied identity/tenant fields.
16. A cached SSR/RSC response containing refreshed `Set-Cookie` or family data is served to another visitor.
17. XSS, a compromised third-party script/dependency, CSRF, or a hostile direct Server Action/Route Handler call acts inside a valid family session.
18. An unprotected preview or production fixture route exposes names, moments, counts, locations, or media without membership.
19. Preview/Production is miswired to the wrong Supabase project, a Proof resource, or an unvalidated redirect origin.
20. Auth-account deletion cascades family history or fails because the user still owns Storage objects.
21. A resumed video upload identifier, temporary object path, filename, or container metadata leaks a family identity or precise location across accounts.
22. A malformed, oversized, highly complex, or adversarial video exhausts browser, worker, storage, or transcoder resources.
23. Video Range delivery, a long-lived signed URL, CDN cache, poster, or transcoded derivative remains usable after membership revocation or deletion.
24. Partial video processing/export/purge removes the database row but leaves an original, derivative, poster, resumable upload, cache entry, or archive copy behind.

## Core mitigations

- Explicit table grants, RLS on every exposed table, fixed-search-path boolean helpers in an unexposed schema, composite tenant foreign keys, immutable ownership columns, and two-circle denial fixtures.
- Membership status checked from the database on every protected operation; membership revocation does not depend on JWT refresh/session revocation.
- Invitation tokens hashed, normalized-email bound, expiring, single-use, rate-limited, and accepted atomically.
- Private buckets; originals via authenticated download; derivatives via freshly authorized controlled delivery; no generic image-optimizer or private service-worker caching.
- Direct idempotent uploads to reserved paths, immutable originals/checksums, stripped display derivatives, and service-side completion verification.
- Descendant policies join to a visible live parent; purge uses an immutable request plus idempotent ledger/tombstone.
- Export workers load immutable authorized job records, recheck requester membership, generate safe filenames, validate circle counts/checksums, and expire artifacts.
- Authenticated routes render per request with private/no-store headers; proxy refresh responses preserve cookie/cache controls; two-browser isolation tests cover refresh, prefetch, sign-out, and account switch.
- A fresh per-request nonce CSP forbids inline handlers/style attributes and constrains scripts, frames, forms, workers, media, and connections to reviewed exact origins; narrow redirect allowlists, same-origin mutation controls, and per-action identity/membership/input validation constrain the remaining browser-session attacks.
- Fail-closed environment identity/project-reference validation rejects Preview→Production, Proof references, and wildcard/caller-controlled redirects; external previews remain deployment-protected until app auth passes.
- Membership removal and Auth-account deletion are separate workflows; family rows do not cascade from `auth.users`, and owned Storage objects are cleared or reassigned before Auth deletion.
- No advertising IDs, session replay, cross-site analytics, public profiles, or third-party family-media hosts.
- Any future video path uses a circle-scoped reserved asset, direct resumable upload to a private bucket, opaque/account-scoped resume state, server-side content verification, bounded isolated transcoding, immutable checksummed original, stripped derivatives/posters, controlled Range delivery, and an idempotent purge ledger. The local feasibility preview provides none of these production guarantees.

## Residual decisions

- Signed derivative URLs have residual access until expiry; PD-006 chooses the window versus an authenticated media proxy.
- Trash retention and immediate purge authority require PD-002/PD-005 approval.
- Backup region/retention and paid recovery features require infrastructure approval.
- Video duration/size/codec, upload/transcode provider, playback/revocation, and MVP inclusion remain pending under PD-004 and its measured production spike.

## Required adversarial actors

Local fixtures must include: two organizers in circle A, ordinary A member, revoked A member with captured token, organizer in circle B, dual-circle user with different roles, authenticated no-circle user, valid/wrong-email/expired/revoked/consumed invitations, managed children in both circles, live/trashed moments and originals/derivatives in both circles, and path-spoof/orphan objects.
