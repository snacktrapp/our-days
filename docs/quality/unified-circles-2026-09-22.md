# Unified Circles

Circles now combines browsing and management at `/circles`. Each circle keeps its View journal link visible. Its right-hand chevron expands people, individual journal links, existing access controls, rename/delete controls, and invitations. Create a circle remains on the same page. The former duplicate directory component is removed.

`/circles/manage` redirects to `/circles`, preserving the selected invitation circle and name. New-circle and legacy Account invitation links point directly to Circles. No membership, audience, database, or deletion-policy changes.

Verification: production webpack build, TypeScript and artifact scan; formatting and ESLint; 38 focused unit tests; 32 mobile Chromium browser tests at 390px and 320px, covering both themes, individual journals, invitations, creation, navigation, and old links. Relevant visual snapshots reviewed. Real installed-iPhone verification remains outstanding.

Not merged or deployed live. The separate local-journal request-verification failure recorded in PR #116 is not addressed by this layout change.
