# Private moment-detail preview evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: decision-independent, fixture-backed front-end contract. This slice establishes how quiet family notes and responses should feel. It does not save data and does not claim that production authentication, authorization, or persistence exists.

## Product contract established

Every timeline card exposes two count-free actions: **Respond** and **Notes**. Both open one native modal sheet owned by a small Client Component; timeline and card content remain server-rendered. The sheet shows people and the words they chose rather than totals, scores, or popularity language.

A compact identity anchor remains visible above independently scrolling content. Photo, thought, place, and milestone moments have distinct visual cues plus their title or excerpt, author, and date. The accessible dialog name uses a bounded excerpt so a long thought cannot create an excessive announcement. The complete moment summary remains available in the sheet body.

The response vocabulary is intentionally small and provisional: **Hold close**, **Made me smile**, and **I remember**. A person can select at most one local response and can clear or replace it. This is a prototype choice, not an accepted production enum or data-model decision.

Existing fixture notes appear as chronological family recollections. A new note can be written, previewed, returned to edit, or cleared. Copy identifies it as private to this family and local-only. No action is labeled Save or Send.

## Local-only state and privacy boundary

- Response and note drafts live only in React state and reset after accepted close, reopen, or reload.
- Closing, Escape, and backdrop dismissal protect dirty state with note/response-specific confirmation copy.
- Interaction creates no HTTP(S) request, WebSocket, storage mutation, IndexedDB operation, Cache Storage mutation, history mutation, URL change, or timeline mutation.
- The photo identity cue is CSS-only, so opening detail does not refetch media or serialize another media URL into the interaction model.
- Hostile HTML/script-shaped note text renders literally through React text nodes.
- A private detail is absent from the closed rendered UI, but fixture detail is intentionally present in the authorized local preview's RSC payload. Production must authorize timeline and detail data identically or fetch detail only after an authorized open.
- Preview enablement requires the explicit flag, `local` identity, `detached` resource mode, and a clean loopback origin. Startup validation and runtime guards share the same policy; hosted Preview/Production combinations fail closed.

## Interaction and accessibility evidence

- Native modal behavior, body-scroll lock, full forward/reverse focus containment, exact opener restoration, Escape/backdrop behavior, and persistent close access are browser-tested.
- All four moment kinds assert their unique note/response payload and absence of every other moment's canary; later empty Photo and Thought moments assert true empty states.
- Family, Molly's personal timeline, and On This Day open the same surface without URL, history, scroll, or focus drift.
- Every visible button and textarea meets the 44 CSS-pixel target contract. Textarea text remains 16 CSS pixels.
- The exact 320×350 viewport exercises response selection/clearing, a long note preview, Back to edit, Clear preview, the persistent identity anchor, and close restoration.
- Axe reports no serious or critical finding in initial, response-selected, valid note-preview, and Thought states.
- Six reviewed visual baselines cover Photo, Thought, Place, Milestone, a populated local note preview, and the dynamic 320×350 state. Repeated runs establish deterministic paint and scroll state.

## Verification snapshot

- `npm run check`: formatting, ESLint, TypeScript, and 178 tests across 15 files passed.
- `npm run test:e2e`: its atomic production build and 14-canary artifact scan passed, followed by 96 browser checks passed, 41 intentional project-specific skips, and no failures.
- Local Playwright inventory: 137 checks across eight files. Prepared hosted CI inventory with WebKit: 180 checks across eight files.
- The complete detail suite passed 15 applicable checks across Chromium mobile, Firefox mobile, and Chromium short; six project-specific checks were intentionally scoped to one engine/viewport.
- The six detail visual states passed three consecutive repeat runs after the final identity/scroll design. The opaque warm backdrop prevents underlying lazy media from creating pixel drift.
- Independent UX/accessibility, privacy/adversarial, and test-gap reviewers returned **GO** after their blocking findings were fixed. Their follow-up polish findings were also applied before the final matrix.

## Production gates deliberately deferred

- Invitation Auth and current family-circle membership checks.
- RLS denials for outsiders, wrong-circle members, and revoked members.
- Immutable author/circle attribution and co-organizer/guardian rules.
- Durable reaction uniqueness and replacement semantics.
- Comment/note create, edit, delete, parent-deletion, retention, and export policies.
- Private original media storage, authorized derivatives, signed delivery, revocation, deletion, and purge evidence.
- Physical iPhone Safari/standalone, VoiceOver, large text, software keyboard, and hosted WebKit evidence.

No Supabase, GitHub, Vercel, email, analytics, or other external resource was created or connected by this checkpoint.
