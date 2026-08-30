# Phase 5 connected access-management checkpoint

Date: 2026-08-30

Status: **local connected slice passes in Chromium — trusted invitation delivery and hosted release evidence remain pending**

This checkpoint replaces the authenticated Family Settings dead end with a real, circle-authorized access surface. It uses the already accepted PD-003 invitation policy but does not create an undeliverable invitation secret. No external resource or personal family data was created.

## Implemented

- Authenticated `/settings/family` routing from the family mark, while preserving the approved detached design-preview route and pixels.
- A caller-scoped roster that distinguishes active sign-in accounts from managed child journals. Revoked accounts are omitted; managed journals remain visible without implying they can sign in.
- Read-only access visibility for ordinary members and organizer-only controls for other active memberships.
- Two-step membership removal with explicit retained-history, account, content, guardian-authority, and later-ownership consequences.
- Minimal pending-invitation visibility for organizers: invitation ID, display name, created date, and expiry date only. Email addresses, hashes, salts, and raw one-time tokens never enter the connected view model.
- Two-step pending-invitation withdrawal. New invitation creation remains disabled until the separately privileged account-provisioning/email worker exists.
- Same-origin checks, fresh organizer authorization, runtime UUID validation, self-removal denial, active-circle target preflights, database-final authorization, generic failures, and route revalidation.
- Adjacent, focusable error recovery for RPC and transport failure; success focus; disabled target switching while a destructive request is pending; target-specific accessible names; 44–46px controls; long-name wrapping; and one-column controls at 350px and narrower.
- Four direct pgTAP assertions for organizer, ordinary-member, revoked-member, and wrong-circle pending-invitation listing behavior.

## Evidence available now

- `npm run check`: formatting, ESLint, TypeScript, 39 test files, and 337 unit/contract/component tests pass.
- `npm run build:webpack`: production compilation, route generation, TypeScript, and the private-artifact scan pass.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 212 pgTAP assertions pass across five files.
- `npm run types:db:check`: committed database types match a clean local rebuild.
- `npm run test:auth:integration`: local signup variants, OTP, invite acceptance, stale-token circle denial, and closed private Storage paths pass.
- `npm run test:db:concurrency`: overlapping organizer revocation, invitation acceptance, content edits, reversible responses, parent trash, and member revocation serialize into valid durable state.
- The connected Chromium journey passes ordinary-member visibility, organizer promotion, minimal pending-invitation rendering, 320×350 organizer reflow and axe checks, real member removal, same-response revalidation, immediate removed-member denial, cross-origin action replay denial, wrong-circle target preservation, real invitation withdrawal, organizer demotion, and the complete existing journal/revocation/account-switch flow.
- The focused detached Chromium matrix passes 30 checks with four intentional project skips. Approved Family Settings screenshots remain unchanged, and the preview still performs no network or browser-state mutation.
- Independent privacy/security, mobile/accessibility, and test-gap reviewers found concrete issues in the first pass. Target naming, narrow reflow, long-name wrapping, transient failure recovery, message placement, role wording, pending-action switching, circle scoping, direct pending-list database coverage, and connected organizer browser proof were fixed and rerun.

## Local verification notes

- The optional local Supabase analytics/vector containers remained unhealthy on this host. The required Postgres, Auth, REST, Storage, and Mailpit services were started without those optional containers; all relevant tests passed.
- The default local Turbopack build again failed because its CSS worker could not bind a local port in this restricted host, including after an approved outside-sandbox attempt. The webpack production build passed. The unrestricted default build remains a hosted CI/Vercel gate.
- The browser-verification CLI named by the local verification skill is not installed in this checkout. Equivalent and stronger checks ran through the pinned Playwright harness: meaningful page content, console/page errors, private headers, interactive controls, axe, viewport overflow, real Server Action traffic, and navigation.

## Deliberate boundaries

- New invitation sending is not connected. The present database creation RPC is used only by trusted local test setup; it is not reachable from the connected screen.
- The trusted worker must provision the Auth user, create the invitation, deliver the fragment-bearing link, handle retry/idempotency, and keep its bypass credential outside the Next.js deployment before sending can be enabled.
- Role changes, managed-profile creation, and guardian assignment remain database-supported but are not exposed in this focused screen yet.
- Permanent deletion, exports, photos, and video remain governed by pending PD-005, PD-006, and PD-004 respectively.
- No GitHub remote, hosted Supabase, Vercel project, SMTP service, domain, worker, analytics, billing resource, or production credential was created.

## Next gate

The remaining decision-independent Family Context work is connected role/guardian/managed-profile administration and the trusted invitation-provisioning contract. Production invitation sending additionally requires approval for the separate worker and email resources. Hosted default-build, WebKit/Firefox connected-browser, and real iPhone evidence remain release gates.
