# Family settings preview evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: decision-independent, fixture-backed front-end contract. This slice establishes how family access and invitations should be explained and reviewed. It does not create accounts, send email, revoke membership, authorize a caller, or persist any change.

## Product contract established

The paired family mark now opens a dedicated **Family settings** route. The People screen's **Family access & invitations** action provides an explicit destination, while the top **Back to People** control names its destination honestly. Primary navigation remains available without presenting Settings as a fifth main destination.

The access list makes a foundational distinction visible:

- Brian and Molly are co-organizers with accounts that can sign in.
- The three children have managed journal profiles and no sign-in access.

Only an account with removable circle access exposes **Review access**. Its focused disclosure explains settled consequences without offering a fake confirmation: removal ends access to this circle, does not delete the person's Auth account or content, and leaves any later deletion to the still-pending ownership policy. It does not imply that an organizer may erase another adult's history.

The invitation form accepts one email address and moves to a review state. It presents the default future role as family member and says that organizer access requires a separate deliberate change. The terminal controls are **Back to edit** and **Clear preview**—never Send or Invite—because no invitation backend exists.

## Local-only state and privacy boundary

- Email and disclosure state live only in the small Client Component and reset on reload.
- Review creates no HTTP(S) request, WebSocket, local/session storage write, IndexedDB operation, Cache Storage mutation, URL/history mutation, email, user, or invitation.
- Script-shaped email input renders literally through React text nodes.
- The route is request-rendered inside the protected journal group, calls the fail-closed design-preview guard before constructing its fixture model, and receives private/no-store/noindex headers.
- Private links disable prefetching. A browser-generated RSC navigation envelope replayed against the preview-disabled server returns only a private redirect payload and no family fixture canary.
- The production build's credential/private-fixture scan covers the new route and found no fixture content in browser-deliverable artifacts.

The local validation is intentionally only an interaction aid. Production invitation creation must use an accepted auth decision, server-side normalized-email handling, rate limiting, hashed single-use tokens, expiry, verified-email binding, current organizer authorization, and database-enforced circle membership.

## Interaction and accessibility evidence

- Invalid email feedback is programmatically connected and restores focus to the field.
- Invitation review focuses its email heading and states the full circle content the invitee would be able to see. Back-to-edit and Clear-preview focus the newly mounted email control rather than a stale element.
- Opening access review focuses its heading and scrolls the consequence into view; closing returns focus to the opener.
- All visible actions meet the 44 CSS-pixel target contract at 320px width, and the email control stays at 16 CSS pixels.
- The route has no horizontal overflow at 320×568 or the 320×350 keyboard-height viewport.
- Axe reports no serious or critical finding in the route and the keyboard-height invitation review.
- Three reviewed Chromium mobile baselines cover the default access list, focused removal consequence, and focused invitation review. A fourth exact 320×350 baseline proves the invitation review and both terminal actions remain above the fixed navigation.

## Verification snapshot

- `npm run check`: formatting, ESLint, TypeScript, and 182 tests across 16 files passed.
- `npm run test:e2e`: its atomic webpack production build and private-artifact scan passed, followed by 113 browser checks passed, 47 intentional project-specific skips, and no failures.
- Local Playwright inventory: 160 checks across nine files. Prepared hosted CI inventory with WebKit: 210 checks across nine files.
- The focused Family Settings suite passed 12/12 across Chromium mobile, Firefox mobile, and Chromium short.
- The client mutation traps and settled-browser inventory cover HTTP/fetch, WebSocket, cookies, local/session storage writes/removals, IndexedDB open/delete, Cache Storage API calls and contents, URL/history state, reload loss, and hostile text rendering.
- Independent UX/accessibility, privacy/adversarial, and test-gap reviewers returned **GO** after the ownership wording, illustrative-account disclaimer, client-boundary narrowing, dynamic-state focus, viewport reachability, service-worker race, and proof-strength findings were fixed.

| Reviewed visual                                                            | SHA-256                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `family-settings-chromium-mobile-chromium-mobile-darwin.png`               | `e04eeb0c5ebe8f62abff198d1e40ec7e44269d9ff749921d23a3ccbdba7dde0b` |
| `family-settings-access-review-chromium-mobile-chromium-mobile-darwin.png` | `2f1da9efef2b33f14ae532239372fa7eec9485777af9138c3947c50d0d019d21` |
| `family-settings-invite-review-chromium-mobile-chromium-mobile-darwin.png` | `89ef68297f01a2a1e47a63aba4e1f2ef0ab5fc998ffa10add5eef386efdebe6d` |
| `family-settings-invite-short-chromium-short-chromium-short-darwin.png`    | `a84b92cf1e2ac4001ac353db319c7bbdf48cc374e02e41ed586ee839a4048e48` |

## Production gates deliberately deferred

- Invitation-bound authentication and PD-003 approval.
- Database membership, role, last-organizer, self-removal, concurrent-change, revocation, and stale-session enforcement.
- Accepted adult deletion and retention policy; the preview deliberately does not settle PD-002 or PD-005.
- Invitation delivery, expiry, resend, revoke, pending-invite, acceptance, wrong-email, replay, and abuse controls.
- Physical iPhone Safari/standalone, VoiceOver, large-text, software-keyboard, and hosted WebKit evidence.

No Supabase, GitHub, Vercel, email, analytics, or other external resource was created or connected by this checkpoint.
