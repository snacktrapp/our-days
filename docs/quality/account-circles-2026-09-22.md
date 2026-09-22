# Account and Circles simplification

## Scope
- Account: personal profile, collapsed color palette, journal/account tools.
- All new disclosures reuse one component with the existing right-aligned SVG chevron; native triangle markers are suppressed in Chromium and WebKit. No relocation cards or migration/internal-behavior explainers appear in normal UI.
- Circles: browse circle journals; expand people only when wanted; create/manage entry point and per-circle management links.
- Management moved to `/circles/manage`, reusing existing invitation/role/member controls. Legacy `settings/family?inviteCircle=...` links redirect while preserving circle/name.
- Circle creation starts with an empty name and an explicit Create circle action. Removed inaccurate "includes everyone" language: existing `create_circle` copies only the creator's profile, not the source membership list.
- No membership inheritance changes, bulk copying, audience changes, or new multi-circle posting behavior.

## Deletion scope and safeguards
`delete_empty_circle` is creator-only, requires exact current name, another retained active circle, exactly one profile/membership, and no stored or linked moments (including private/trashed entries). Other dependent history retains its restrictive foreign keys and aborts deletion.

Five circular identity FKs change from RESTRICT to deferred NO ACTION, not CASCADE. The existing membership integrity trigger permits deletion only after the parent circle is absent and only for the calling account's row; existing identity and account-closure checks remain unchanged. No direct client DELETE grants. Deletion serializes per actor and locks the target circle. UI requires a named confirmation; preview/local fixture modes never claim to delete real data.

## Verification
- Production webpack build, TypeScript, touched-surface ESLint and private artifact scan passed.
- Full Vitest run: 1,568 passed, 3 skipped.
- Local DB: 13 deletion, 11 creation and 99 account-closure assertions passed (123 total).
- Local security advisors: no issues.
- Mobile browser: Account → Circles → create, active bottom navigation, legacy invitation redirect, collapsed colors and both themes, 390px and 320px widths.
- Existing invitation/access review and keyboard-height flows pass after their route expectations were updated. Relevant visual baselines refreshed and reviewed.
- After the final chevron/copy revision: 105 focused unit tests and 8 mobile Chromium browser checks passed. Local WebKit crashes at process launch (Bus error 10) before navigating, so Safari/installed-iPhone verification remains outstanding; no application failure was observed from that unavailable engine.

## Release status
Not deployed. Migration is applied only to the local test database. Do not blanket-push migrations: historical local/live migration timestamps differ.

User-requested live circle `Empty` (`bfd6b1bb-306d-4f1c-9fe4-c87ec91a307a`) was read-only verified: Brian is its creator/sole active organizer; one profile, one membership, zero stored and linked posts. It has NOT been deleted. Apply the reviewed migration as part of release, then use the guarded deletion flow; do not bypass history constraints.

Physical deletion of these unused identity rows is not undoable in-app. Existing populated circles and journal content are not removed by this feature.
