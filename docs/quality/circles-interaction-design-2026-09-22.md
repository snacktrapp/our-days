# Circles interaction redesign

- Keep journal links directly accessible; give circles separated surfaces and consistent spacing.
- Keep people visible when expanded. Collapse invitations and rename/delete settings behind the existing right-chevron disclosure.
- Open person management and pending-invitation management in a native bottom sheet using the existing modal/scroll-lock utilities. Close via X, backdrop, or Escape; preserve the underlying scroll position. Disable dismissal during an action.
- Remove repeated account/sign-in status and duplicate pending labels; retain organizer, operations, and managed-journal distinctions.
- No membership, database, authentication, or deletion-policy changes.

## Verification

- Production webpack build, TypeScript and private-artifact scan passed.
- Changed-file formatting and ESLint passed.
- 30 family-settings component tests passed, including connected action success/failure behavior.
- 18 browser tests passed at 390px and 320px, including scroll restoration, sheet bounds/dismissal, invitations, creation, settings confirmation and reduced keyboard-height layouts.
- Visual baselines updated and reviewed. A concurrent screenshot run initially lost its shared server; the short-height case was rerun independently.
- Real installed-iPhone keyboard behavior and connected production mutations were not tested.

## Remaining functional issue

Deletion of the existing Empty circle is NOT fixed by this UI change. The existing delete function leaves foreign-key references intact and aborts safely if any remain; prior investigation found a web-push subscription reference. No data was removed and no database safeguards were relaxed. Follow up separately with a targeted, verified cleanup policy for non-content references.

Not merged or deployed to production.
