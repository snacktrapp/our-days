# Our Days — product and architecture brief

_Working title. This document defines the first product slice; it is not a commitment to the name._

## Workspace report

- The workspace contains multiple existing projects under `Documents`, with substantial Proof-related work under `Documents/Proof` and `Documents/Codex`.
- No existing family-journal, Path-inspired, or similarly named app was found.
- The approved prototype remains at `Documents/Codex/family-journal-prototype` as a visual reference.
- Production work lives in the separate standard Next.js repository at `Documents/Codex/our-days` and has no dependency on Proof.
- The production repository currently has no Supabase connection, Vercel link, real accounts, or personal media.
- Production setup must use a new GitHub repository, Supabase project, Vercel project, domains, secrets, storage buckets, and service credentials. Nothing from Proof should be copied or referenced.

## Concise product brief

### Promise

Our Days is a private, invitation-only family journal where each person’s life has its own chronological record and those records come together as one shared family history.

### Core audience

The first circle is two co-organizers and their three children. Later, the same model can include relatives without adding complexity to the initial interface.

### Product identity

The center line is not decoration; it is the organizing idea. Dates, quiet gaps, author-colored nodes, and distinct moment forms should make scrolling backward feel like traveling through a life. The phone layout keeps cards readable by placing the connection above a nearly full-width card. Wider layouts may alternate cards around the center line.

### Emotional standard

The experience should feel calm, warm, tactile, and slightly nostalgic. Success is not time spent, posting frequency, or engagement. Success is that a family member wants to add an ordinary moment and enjoys returning to it years later.

### Non-goals

No public identity, follower graph, discovery, recommendations, ads, streaks, engagement prompts, ranking, or popularity metrics. Search and organization should help memory retrieval, not content consumption.

## MVP definition

### Include

- Invitation-only sign-in and one private circle
- Brian and Molly as co-organizers
- Five person records, including managed profiles for children who do not yet sign in
- Combined chronological timeline and individual person timelines
- Photo and written moments
- An authoritative `occurred_on` family-calendar date independent of upload time, with optional precise time/timezone for memories that have one
- Optional place and tagged people
- Milestone moment type
- Comments presented as private notes, plus a very small reaction vocabulary without public-style totals
- Date/year browsing and basic “On this day”
- Private original media plus display derivatives
- Invite, revoke, and role management
- Full export of structured data and original media
- Short video only after the photo pipeline is proven; recommended first limit is 60 seconds

### Wait

- Multiple-circle interface (the schema supports it from day one)
- Native iOS app, widgets, share extension, and background upload
- Place map/explorer beyond a simple place index
- Full-text or semantic search
- Face recognition, automatic people suggestions, or AI-generated captions
- Realtime activity indicators and push-notification growth loops
- Photo books, printing, collaborative albums, and external sharing links
- Granular per-post audiences inside a circle
- Imports from legacy social networks or camera-roll backfills

## Screen map

```text
Invite / sign in
└── Family circle
    ├── Family timeline
    │   ├── Moment detail
    │   └── Notes / understated reaction
    ├── People
    │   └── Person timeline
    ├── Add Moment (bottom sheet)
    │   ├── Photo / short video
    │   ├── Thought
    │   ├── Milestone
    │   └── Place
    ├── Memories
    │   ├── On this day
    │   ├── Years
    │   └── Milestones
    └── Family settings
        ├── Members and invitations
        ├── Roles and access removal
        ├── Export
        └── Trash / deletion
```

## Key user flows

1. **Join safely:** Organizer creates an invite for one email → recipient uses a single-use link or code before expiry → auth identity is created or verified → membership becomes active → recipient lands in the family timeline.
2. **Add quickly:** Tap the central add button → choose photo/video, thought, milestone, or place → optionally choose the journal person, actual date, people, and location → save → moment appears by its occurrence date/time, not upload time.
3. **Backfill a child’s memory:** Parent chooses a child’s journal → adds the old date and source media → the card appears at the right historical point and records who added it.
4. **Travel through one life:** People → Molly → scroll through only Molly’s journal with Molly’s color and visual tone → switch back to the combined family view without losing chronological context.
5. **Revoke access:** Co-organizer revokes a membership → database, original-media, and newly authorized derivative requests fail immediately → any previously issued derivative URL has only its explicitly approved residual lifetime → refresh sessions are revoked → audit entry records the action.
6. **Take ownership:** Co-organizer requests export → background job produces a manifest, JSON/CSV records, comments/reactions, and untouched originals with checksums → expiring download becomes available.

## Technical direction

### Recommendation

Use Next.js, React, TypeScript, Tailwind CSS, Supabase, GitHub, and Vercel for production. This is a strong fit for the team’s familiarity and for an MVP whose risk is product feel and authorization rather than novel infrastructure.

Build a mobile-first PWA first. It can install cleanly on iPhone and cover the core capture/browse experience. Keep media processing, invitation, export, and authorization behind typed server boundaries so a later native client can use the same APIs. A later Expo/React Native app can share schemas and domain logic, but should not be assumed to share all UI code.

### Meaningful tradeoffs

- A PWA is the fastest path to an excellent timeline, but iOS background uploads, share-sheet integration, camera-roll access, and push behavior are less capable than native. Those limits matter most when video and effortless capture become central.
- Supabase reduces auth, Postgres, and storage work, but privacy still depends on explicit grants, complete RLS policies, storage policies, and tests. “Authenticated” is not sufficient authorization.
- Vercel is a natural Next.js host. Long-running export/media work should run as queued jobs or dedicated workers rather than a request that may time out.
- The service worker caches only an explicit allowlist of versioned public shell assets. It never caches authenticated responses, private originals, derivatives/thumbnails, signed URLs, drafts, or family records; sign-out/account-switch purges account-scoped browser state.

## Initial data model

The key modeling choice is to separate a **person whose journal this is about** from the **authenticated user who recorded it**. That lets parents preserve a young child’s life without pretending the child had an account.

| Table                | Purpose and important fields                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `circles`            | `id`, `name`, circle-bound creator membership, timestamps. Multiple circles are supported even while the UI exposes one.                                                                                                                                                              |
| `people`             | A human journal identity: `id`, `circle_id`, display name, avatar/color, account-or-managed profile kind, and circle-bound creator membership. A managed profile has no login.                                                                                                        |
| `circle_memberships` | Access principal: `circle_id`, `user_id`, linked `person_id`, `role` (`organizer`, `member`), `status`, `revoked_at`. Unique circle/user pair.                                                                                                                                        |
| `person_guardians`   | Revocable grants recording which active members may add to or manage a child/managed person journal. Revoking membership also revokes these grants so reinvitation never silently restores guardian authority.                                                                        |
| `invitations`        | Private table with `circle_id`, target person, salted email hash, `token_hash`, expiry, inviter membership, and accepted/revoked timestamps. Raw tokens and plaintext addresses are never stored; invitations grant member access only, and organizer promotion is a separate action. |
| `moments`            | `id`, `circle_id`, `journal_person_id`, `recorded_by_user_id`, type, body, authoritative `occurred_on`, optional `occurred_at`/time/timezone, date precision, place reference, created/updated/deleted timestamps.                                                                    |
| `moment_people`      | Tagged people; unique moment/person pair.                                                                                                                                                                                                                                             |
| `places`             | Circle-private normalized label and optional coordinates. Coordinates can be reduced in precision later.                                                                                                                                                                              |
| `media_assets`       | Moment link, private bucket/path, original filename, MIME, bytes, dimensions/duration, SHA-256, derivative relationship, upload state.                                                                                                                                                |
| `comments`           | Circle and moment IDs, author user ID, body, timestamps, soft-deletion metadata.                                                                                                                                                                                                      |
| `reactions`          | Moment, user, constrained reaction type, timestamp; unique per moment/user/type. UI avoids aggregate popularity framing.                                                                                                                                                              |
| `export_jobs`        | Requester, circle, state, output path, expiry, manifest checksum, timestamps.                                                                                                                                                                                                         |
| `audit_events`       | Private, circle-bound security events attributed through an actor membership: invite, role change, revoke, export, destructive delete. No address, token, moment text, or location is copied into logs.                                                                               |

Important indexes: moments on `(circle_id, occurred_on desc, occurred_at desc, id desc)`, moments on `(circle_id, journal_person_id, occurred_on desc, occurred_at desc, id desc)`, active memberships on `(user_id, circle_id)`, comments on `(circle_id, moment_id, created_at)`, and media on `(circle_id, moment_id)`.

## Privacy and ownership architecture

### Database authorization

- Enable RLS on every exposed table. Revoke default `anon` and `authenticated` grants, then grant back only required operations.
- Signed-out users receive no table or bucket access.
- Every circle-owned row carries `circle_id`; every policy checks an active row in `circle_memberships` for `(auth.uid(), circle_id)`.
- Organizer actions require the same active membership plus `role = 'organizer'`.
- Writes to a managed child journal additionally require `person_guardians` authorization.
- Do not authorize from user-editable metadata. Do not treat `TO authenticated` as authorization.
- If membership helper functions are needed to avoid recursive policies, keep them in an unexposed `private` schema, fix `search_path`, explicitly check `auth.uid()`, revoke default `PUBLIC` execution, and grant only the precise function to `authenticated`.
- Views must use `security_invoker = true` or stay outside exposed schemas.
- Create allow/deny database tests for member, non-member, revoked member, organizer, ordinary member, and managed-child cases for each operation.

### Media

- Use private buckets only. Recommended split: immutable originals and regenerable display derivatives.
- Path shape: `<circle_id>/<asset_id>/<variant>.<ext>`. Storage policies verify the first segment maps to an active circle membership and that the asset row belongs to that circle.
- Preserve original bytes and a SHA-256 checksum. Never overwrite originals; rotation/crop/edit creates metadata or a derivative.
- Prefer authenticated downloads for the strictest access. If signed derivative URLs are approved, create them server-side only after a fresh membership check, keep them around one minute, never store them, and keep object cache lifetime no longer than URL lifetime. A pre-issued URL remains usable until expiry after access removal; originals do not use this path.
- Strip location metadata from display derivatives by default while preserving the original file privately. Show an explicit location only when the author chooses one.
- Keep service-role credentials only in the separately deployed narrow worker environment; the ordinary Next web deployment and every browser variable remain bypass-credential-free.

### Invitations and removal

- Disable open self-service joining. An auth account alone grants no circle access.
- Bind each invitation to the intended normalized email, store only a token hash, expire it, and allow one acceptance.
- Rate-limit invitation creation and acceptance; record audit events without storing raw tokens.
- Revocation flips the membership status in the database first, so RLS blocks the next request even if a JWT is still live. Then revoke refresh sessions. This avoids relying on stale JWT app metadata.

### Deletion and export

- Recommended deletion behavior: moments enter a 30-day private trash visible to organizers and their creator, then purge rows, derivatives, and originals. A user can request immediate irreversible purge when legally or personally necessary.
- An organizer should not silently edit another adult’s words. Co-organizers can manage access and managed-child journals; deleting another adult’s content should require an explicit policy decision.
- Export should contain a human-readable index, JSON, CSV where useful, original media, comments/reactions, timestamps, attribution, and a checksum manifest. Export files live in a private short-lived bucket and are purged automatically.

### Tracking

Use no advertising IDs, session replay, third-party pixels, or cross-site analytics. If product analytics are later needed, collect minimal first-party events without bodies, filenames, coordinates, or media URLs, and make retention short and documented.

## Implementation plan: small, testable phases

The authoritative, gated delivery plan is `docs/architecture/PHASES.md`. External GitHub, Supabase, Vercel, domain, and paid service creation occurs only in its final production-release phase after explicit approval. Earlier phases are local and use synthetic fixtures; every authorization-bearing phase includes member success plus wrong-circle, non-member, and revoked-member denial evidence.

## Product decisions

Brian accepted the child-journal/guardian model (PD-001), adult authorship and deletion boundary (PD-002), and invitation-bound emailed code/link sign-in (PD-003) on 2026-08-30. Their exact binding wording is recorded in `docs/architecture/DECISIONS.md`.

The remaining decisions are intentionally deferred until their consuming phases:

1. **Video boundary (PD-004):** Is a 60-second, one-video-per-moment cap acceptable for the first release? This keeps transcoding, mobile upload recovery, storage cost, and export behavior testable.
2. **Trash (PD-005):** Is a 30-day private trash acceptable, with hard purge performed only by an authorized idempotent worker? Recommendation: yes.
3. **Derivative delivery (PD-006):** Prefer roughly one-minute signed display URLs after a fresh membership check, accepting that pre-issued URLs survive until expiry, or require an authenticated proxy for stricter immediate revocation? Recommendation: short-lived display URLs for MVP; originals always use authenticated delivery.

Names, logo, exact colors, reaction vocabulary, and the eventual native path can wait until the timeline direction is approved.

## Current-source notes

- Supabase’s current RLS guide emphasizes that grants and policies are separate controls, recommends revoking defaults and testing each table, and warns that a table in an exposed schema without RLS can be reachable through the API: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage is private by default when using private buckets and supports access through authenticated requests or time-limited signed URLs: https://supabase.com/docs/guides/storage/security/access-control and https://supabase.com/docs/guides/storage/serving/downloads
- The August 2026 changelog was reviewed for relevant breaking changes. The current changes surfaced there do not alter this proposed managed-hosting RLS/storage design: https://supabase.com/changelog
