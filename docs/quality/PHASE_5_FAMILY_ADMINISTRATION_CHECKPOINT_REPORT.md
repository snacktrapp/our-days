# Phase 5 family administration checkpoint

Date: 2026-08-30

Status: **local role and child-journal care slice passes in Chromium and Firefox — hosted WebKit and managed-child lifecycle decisions remain pending**

This checkpoint connects organizer-only role and journal-care administration to the existing private Family Settings surface. It uses synthetic local family data, creates no external resource, and does not add managed-child creation before its correction and future-account-claim policy is decided.

## Implemented

- Organizer-only promotion and demotion of other active account members. Self-role controls remain hidden and denied; the database keeps the last-organizer invariant final.
- Organizer-only explicit guardian assignment and removal for managed child journals. Organizers retain implicit care for every child journal, while an explicit assignment remains effective if that person later becomes an ordinary family member.
- Read-only Family Settings for ordinary members. Guardian assignment rows and control metadata do not cross the Server Component boundary for non-organizers.
- Clear separation between account access and child journals: the “People and access” view explains that child journals cannot sign in and shows role/journal-care controls only where they apply.
- Target-specific, adjacent status messages, focus restoration, 44px controls, one-dimensional 320px reflow, stable visible labels during pending state, and accessible names that preserve each visible button label for speech control.
- Same-origin checks, fresh organizer authorization, strict runtime input validation, active-circle target preflights, narrow RPC mutation, and revalidation of Family Settings, People, Family, and the affected personal journal.
- Desired-state recovery: repeated role/guardian changes produce no false audits; an already-completed same-circle membership removal reconciles successfully after a lost response and creates no second revocation audit.
- Directional `membership_promoted` and `membership_demoted` audit events. Legacy `membership_role_changed` remains accepted for existing history.

## Security and concurrency evidence

- `npm run check`: formatting, ESLint, TypeScript, 39 test files, and 362 unit/contract/component tests pass.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 264 pgTAP assertions pass across seven files. The 27-case family-administration suite covers no-ops, directional audits, null/invalid and cross-circle input, ordinary/revoked/no-circle actors, account/managed-profile boundaries, explicit authority gain/loss, last-organizer enforcement, grant-free organizer child authority, and idempotent membership removal.
- `npm run types:db:check`: committed public database types match the rebuilt local schema.
- `npm run test:db:concurrency`: reciprocal organizer revocation, reciprocal organizer demotion, duplicate guardian grant, guardian-grant versus membership-revocation, invitation acceptance, moment/tag edit, note/reaction, parent-trash, and membership-revocation races serialize into valid durable state.
- `npm run build:webpack`: the production build, route generation, TypeScript, and private-artifact scan pass.
- The complete connected journey passes in Chromium and Firefox. It verifies ordinary-member control absence; real role promotion/demotion; real guardian assignment/removal; target authority gained and lost on fresh requests; child-journal writes allowed while assigned and denied after removal; 320×350 layout; Axe; cross-origin Server Action rejection; wrong-circle replay denial; membership removal; and the existing invitation, memory, composer, conversation, trash, sign-out, and cleanup stories.
- Detached Family Settings/mobile behavior passed across mobile Chromium, Firefox, 320px, and 200%-equivalent reflow. The two intentionally changed Family Settings screenshots were inspected and regenerated; the focused visual run passed 13 checks with 11 project-intentional skips.
- Three independent adversarial reviews covered database authorization/concurrency, connected-flow completeness, and accessibility/mobile recovery. Reported release blockers were fixed and sent back for re-review.

## WebKit evidence boundary

Playwright WebKit 2251 crashes before page launch with macOS bus error 10 on the current macOS 14.1 host. A forced clean browser reinstall reproduced the same runtime failure, and Playwright reports that this operating system receives a frozen WebKit build. This is not an application pass or failure. Linux WebKit in hosted CI and a real current iPhone remain release gates.

## Deliberate boundary

Managed-child creation is not exposed yet. The existing RPC is not request-idempotent, and production needs humane correction, reversible empty-journal archive, and future child-account claim behavior first. PD-007 through PD-010 record the few remaining choices. Invitation creation/delivery, photo storage/derivatives, export jobs, video, and irreversible purge remain separate slices.

## Next gate

After PD-007 through PD-010 are decided, make managed-child creation request-idempotent and add its correction/claim lifecycle before storing real child history. If those decisions wait, continue with decision-independent export manifest and ownership groundwork without weakening the current private-media boundary.
