# Share a private post to one circle

Status: implemented locally on `codex/share-private-post`, including the user-approved cross-circle conversation prerequisite. Not deployed. Connected-preview media verification remains a release gate.

## Implementation and verification — 2026-09-21

- Private-to-one-circle sharing saves content and audience in one transaction. Existing post/media identifiers and chronology remain unchanged. The editor confirms disclosure of existing comments/reactions and preserves the draft on failure.
- Destination-only members can comment, react, and edit/remove their own comments. Attribution uses their actual membership; no membership is silently created in another circle.
- Ordinary edits do not restore the original circle. Individual-person feeds honor audience visibility. Push recipients must still belong to an actual audience.
- Local database sharing tests: 32 assertions passed. API-signature/privilege tests passed. Database lint and security advisors reported no errors.
- Type-check, ESLint, production build, and 1,563 unit tests passed (3 existing skipped tests). Mobile Chromium local-store flow passed: create private note, edit, select circle, confirm, save, reload, and verify audience editing is no longer offered.
- Full database suite is **not green**: `photo_original_promotion.test.sql` assertion 59 expects same-worker expired-lease reclaim to fail. Existing migration `20260911141000_restore_photo_storage_read_grants.sql` explicitly permits that reclaim. This feature does not change the validator. Correct that stale test separately before calling the full release suite clean.
- Not yet verified: connected-preview carousel/video sharing, real iPhone PWA flow, and loss-of-membership/media-processing races. Local browser evidence is not a substitute for these checks. No production data or schema changed.

## Historical preflight finding (subsequently approved by the user)

The earlier review was incomplete about recipient participation. The local database test `supabase/tests/database/notes_reactions_live_moment.test.sql` was run against `supabase_db_our-days` on 2026-09-21. All eight assertions passed, including the explicit assertion that a member belonging only to the linked destination circle cannot create a comment on the original-circle post. The test ran in a rolled-back transaction; no production data was touched.

The current `create_moment_note` and `set_moment_reaction` functions require an active membership in `moments.circle_id`. The `moment_notes_author_fkey` and `moment_reactions_author_fkey` also require the author's membership and post to belong to the same circle. Therefore changing only the share operation or audience links cannot satisfy the required destination-only comment/reaction test.

Supporting the proposed feature correctly requires changing conversation authorship across circles, including author-name lookup, edit/remove ownership, reaction identity, and activity attribution. This changes an existing enforced behavior and is a broader prerequisite than the initial brief suggested. Do not silently create destination users as members of the original circle, copy the post, or weaken visibility checks as a workaround. Confirm this expanded prerequisite before implementing it.

## Product decision

Let the author share an existing Just me post with exactly one circle they currently belong to. This is not general circle editing. Keep the same post, media, original date/time, caption, location, tags, comments, and reactions. Do not duplicate the post or upload its media again.

The author's existing private comments and reactions become visible with the post. There is no other participant's private conversation to migrate. Ordinary checks still apply: the actor must be the recorder, the post must still be private and live, and the chosen circle membership must still be active.

## Findings from the current repository

- `src/features/moments/moment-actions.ts` already exposes `setMomentAudienceAction`, validates selected memberships, and calls `set_moment_audience`.
- `supabase/migrations/20260907211855_set_moment_audience.sql` currently requires the selected audiences to include the post's original `circle_id`. This does NOT implement arbitrary single-circle sharing as proposed. It also permits broader audience changes and uses journal-management authorization; it is not an author-only, private-to-shared operation.
- `supabase/migrations/20260907204138_moment_circles.sql` separates the post's storage/attribution circle from audience links. `can_read_live_moment` uses those links for shared access. The audience-change trigger automatically adds the original circle, so a final single-circle audience must be established in the same transaction and remain stable on later edits.
- `supabase/migrations/20260912144544_notes_reactions_live_moment_read.sql` gates comments/reactions through the parent post. Their records can stay attached to the existing post ID.
- `updateWrittenMomentAction` currently calls `update_family_moment` before a separate `setMomentAudienceAction` call when audience links are supplied. Do not use that two-step sequence for this feature: failure between calls could leave content/visibility partially changed.
- `supabase/migrations/20260913143000_moment_people_live_moment_read.sql` contains an individual-person feed branch using the original circle and `audience = 'family'`, rather than checking the requested audience links. Review and test this before allowing an original circle to be excluded. A link-only change is insufficient.
- The composer already has audience machinery, but editing passes `lockedCircleId={editDraft?.circleId}`. Reuse the visual controls where appropriate; do not simply unlock the existing multi-circle editor.

## User experience

1. For an authored, published Just me post, Edit offers “Share to a circle.”
2. Choose exactly one active circle; default remains Just me until explicitly chosen. No circle creation or invitations in this flow.
3. Before committing, confirm: “Everyone in [circle] will be able to see this post, including your comments and reactions.”
4. After successful save, return to the same post on the timeline with its updated audience chip. Retain its original chronological position and inclusion in the author's personal journal.
5. On failure, keep the post private and retain the user's edit draft with a clear retry message. Do not show sharing success before it is confirmed.
6. Shared posts offer no audience change through this feature. Do not introduce circle-to-circle moves, multiple destinations, or shared-to-private transitions.

## Implementation plan

- Prefer a narrow private-to-one-circle database operation over widening the existing general-purpose setter. Check current audience, recorder identity, expected revision, live/published state, and destination membership inside the transaction. Lock the post to prevent conflicting saves.
- Keep the original storage/attribution circle and media object paths unchanged. Atomically establish exactly the selected audience link and shared visibility. Do not rely on changing `moments.circle_id`, which would affect attribution and related records.
- If content edits and sharing are saved together, commit them atomically. Do not flip visibility in the ordinary update before the share operation.
- Check feed, conversation, media delivery, person tags, activity and push recipient code for assumptions that the storage circle is always an audience. Fix only the paths required for correct single-circle access; no general refactor.
- Ensure members of the selected circle can both see media/conversation and add comments/reactions, even if they are not members of the original circle.
- Refresh affected feed/cache state without duplicating the post or resetting navigation. Keep local test-store behavior aligned with production.
- Preserve current notification behavior unless a share notification is explicitly approved; do not create a new notification feature as part of this change. Any existing delivery must target only authorized viewers.

## Required verification before shipping

Use an author belonging to circle A and circle B, a member only in A, a member only in B, and an unrelated account. Start with a private post stored under A; share it ONLY to B. This is the decisive test, not just sharing back to A.

- B-only member can see the post, all carousel photos/video, caption, original metadata, author's comments and reactions, and can comment/react.
- A-only and unrelated accounts cannot retrieve it through circle feeds, person feeds, All circles, direct post/conversation requests, or media endpoints. They receive no activity/push disclosure.
- Author still sees exactly one post in their own journal and All circles; chip names only B. Original date/time and media IDs/paths remain unchanged.
- Repeat for note, Bible verse, single photo, carousel, and video. Check existing self-comment and self-heart preservation.
- Unauthorized actor, stale revision, lost destination membership, trashed post, processing media, and already-shared post are rejected without partial changes.
- Double submit/retry never duplicates a post or changes its audience a second time. A later ordinary caption edit must not silently re-add A.
- Cancel leaves the private post unchanged. Failed save preserves the draft and does not claim success.
- Existing private posting, shared posting, circle feeds, personal journal, editing, comments, reactions, and media loading continue to work.
- Run database-backed access tests, action/component tests, and mobile browser flows. Verify on a preview connected to the real data path before production; synthetic preview alone cannot establish this feature's correctness.

## Scope and release

No redesign, re-upload, new audience model, or enterprise workflow. This is a contained feature, but not a dropdown-only change. Review current deployed schema against these checked-in definitions before implementing a migration. Deploy only after the destination-only test passes; keep a UI rollback available without undoing valid shared posts.

Conclusion: technically feasible using existing post IDs and audience links. The repository review supports the design, but correctness remains unproven until the atomic transition and cross-circle access tests pass.
