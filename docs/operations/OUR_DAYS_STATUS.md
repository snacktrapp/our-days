# Our Days — product + ops checkpoint

Dated **2026-09-18**. Resume document for any agent without chat history.

This is a state checkpoint, not a product spec. Do not treat it as permission to change app source, reopen closed palette PRs, or unpark notifications.

## Current navigation work — 2026-09-18

The current branch, `codex/journal-circles-navigation`, starts at `95dd8c8` (carousel loading, #87), after the reliability work in #86. Brian approved implementing the IA below. This branch is for preview review; production promotion still requires approval.

- Settings replaces the duplicate header Add. Bottom navigation is Journal · Add · Circles.
- The primary selector contains only Just me / All circles. Circles lists existing circles and their people using the existing membership-filtered loader.
- Circle/person drill-ins have named headers and Back to Circles. Pagination preserves that context. They do not change the remembered primary Journal mode.
- Mode preference is tab-scoped; no person identity or journal data is stored. Loaded and temporary loading shells share JournalHomeLink. `/journal?view=you` resolves the signed-in identity if a temporary shell has no person ID yet.
- No migrations, new dependencies, palette changes, or notification changes. Existing posting identity and audience defaults remain intact.

The historical checkpoint below was verified at `5a2323e` — *Keep timeline photos and videos inline (#82)* — and predates #86/#87.

---

## 1. Repo / ownership

| Item | Lock |
| --- | --- |
| Repo | [`snacktrapp/our-days`](https://github.com/snacktrapp/our-days) |
| GitHub org | **snacktrapp** — not brian-voler |
| Brian | Phone soak only. Merge decisions stay with Brian. |
| Agents | Smash, find, and fix. Do not ask Brian to babysit Quality/Preview. |
| Cody | Coding specialist. Watch Quality/Preview and report to TARS. |
| TARS | Front door. **TARS launches CloudAgents.** No dual-launch. |

---

## 2. Product bar (definition of good)

The family opens and lives in the app without:

- broken chrome
- dead media
- interrupt / “story interrupted” cards
- stuck upload chips
- notification spam

Brian soaks only. Agents do adversarial smash + fix.

---

## 3. Model lock

Harden / make-it-work CloudAgents pin **Codex (`gpt-5.3-codex`)** at **high** or **extra-high**.

**Not Auto.**

---

## 4. IA locks (do not regress)

- Header: **Just me \| All circles**
- **Circles** tab + **People**
- **Settings** top-left
- Bottom nav: **Journal · Add · Circles**
- Audience chips: **decoration only** (no tap expand) — shipped in #58
- Post-to defaults: keep as currently shipped
- Fullscreen lightbox: translucent X + native fade/pinch
- Do not regress custom video chrome. #80 / #81 / #82 replaced custom video overlay with native fullscreen and kept timeline media inline.

---

## 5. Recent merges (harden wave)

Notable merges **2026-09-13–14**. SHAs are merge-commit OIDs from GitHub.

| PR | Merged | SHA | Title |
| --- | --- | --- | --- |
| [#57](https://github.com/snacktrapp/our-days/pull/57) | 2026-09-13 | `a7e4d1e` | Refresh the journal when the app returns to the foreground |
| [#58](https://github.com/snacktrapp/our-days/pull/58) | 2026-09-13 | `ec1e4eb` | Make audience chips decoration-only (no tap expand) |
| [#59](https://github.com/snacktrapp/our-days/pull/59) | 2026-09-13 | `5bd5eea` | Keep the journal tab bar pinned during iOS pull-down |
| [#60](https://github.com/snacktrapp/our-days/pull/60) | 2026-09-13 | `14ced32` | Hide the journal tab bar while writing an inline note |
| [#61](https://github.com/snacktrapp/our-days/pull/61) | 2026-09-13 | `fe9510e` | Fix timeline photos that fail to open despite present blobs |
| [#62](https://github.com/snacktrapp/our-days/pull/62) | 2026-09-13 | `6491c9e` | Keep Account→Journal remounts off the interrupted-story card |
| [#63](https://github.com/snacktrapp/our-days/pull/63) | 2026-09-13 | `5c3d5f4` | Smash: encode harden matrix and remaining throw paths |
| [#64](https://github.com/snacktrapp/our-days/pull/64) | 2026-09-13 | `fd86740` | Keep People journal remounts off the interrupted-story card |
| [#65](https://github.com/snacktrapp/our-days/pull/65) | 2026-09-13 | `1002ca8` | Smash: fail-close truncated video ranges and untrap remount, lightbox, and notes |
| [#66](https://github.com/snacktrapp/our-days/pull/66) | 2026-09-13 | `c1836ba` | Harden composer media queue, draft blobs, poster retry, and linked tags (live `moment_people` mig) |
| [#67](https://github.com/snacktrapp/our-days/pull/67) | 2026-09-13 | `16ac325` | Clear zombie paused-upload chips after publish or cancel (Molly) |
| [#68](https://github.com/snacktrapp/our-days/pull/68) | 2026-09-13 | `ab3139f` | Keep All-circles refresh off the interrupted-story card |
| [#69](https://github.com/snacktrapp/our-days/pull/69) | 2026-09-14 | `a18c5ec` | Stream journal chrome and first moment on cold open |
| [#70](https://github.com/snacktrapp/our-days/pull/70) | 2026-09-14 | `4becbc1` | Coalesce multi-photo edit pushes to one notification |
| [#71](https://github.com/snacktrapp/our-days/pull/71) | 2026-09-14 | `604de3c` | Fill lightbox to the visual viewport and overlay Close |
| [#72](https://github.com/snacktrapp/our-days/pull/72) | 2026-09-14 | `fef86b5` | Keep journal remounts off the interrupted-story card |
| [#73](https://github.com/snacktrapp/our-days/pull/73) | 2026-09-14 | `4640ffc` | Fix album tap, note keyboard, and stuck fail chips |
| [#74](https://github.com/snacktrapp/our-days/pull/74) | 2026-09-14 | `8d416ad` | Harden composer queue visibility and draft media durability |
| [#75](https://github.com/snacktrapp/our-days/pull/75) | 2026-09-14 | `9c85411` | Add lightbox retry recovery for failed private photo fetches |
| [#76](https://github.com/snacktrapp/our-days/pull/76) | 2026-09-14 | `cdc002e` | P0 hotfix: keep cold-open journal bootstrap misses off JournalInterrupted |
| [#77](https://github.com/snacktrapp/our-days/pull/77) | 2026-09-14 | `36cfabf` | Fix family cold-open interrupt fallback and service-worker refresh |
| [#79](https://github.com/snacktrapp/our-days/pull/79) | 2026-09-14 | `3520452` | Restore family content paint after cold open |
| [#80](https://github.com/snacktrapp/our-days/pull/80) | 2026-09-14 | `46d97dd` | Fix iOS native video fullscreen controls |
| [#81](https://github.com/snacktrapp/our-days/pull/81) | 2026-09-14 | `e826fc1` | Replace custom video overlay with native fullscreen |
| [#82](https://github.com/snacktrapp/our-days/pull/82) | 2026-09-14 | `5a2323e` | Keep timeline photos and videos inline |

#78 is open (draft), not in this merge list. There is no merged #78 in the harden wave.

---

## 6. Open PRs

Verified open on 2026-09-18:

| PR | State | Branch | Notes |
| --- | --- | --- | --- |
| [#78](https://github.com/snacktrapp/our-days/pull/78) | **draft** | `cursor/user-functionality-review-aba1` | Harden timeline recovery and journal switcher UX |
| [#55](https://github.com/snacktrapp/our-days/pull/55) | open | `cursor/notification-domain-rebuild-0b70` | Rebuild family notifications behind one domain entry — **PARKED** until Brian phone-push GO |
| [#34](https://github.com/snacktrapp/our-days/pull/34) | open | `cursor/just-me-catalog-v1-0a14` | Just me catalog v1 (Insights + Daily prayer) — parked / older |
| [#12](https://github.com/snacktrapp/our-days/pull/12) | open | `cursor/just-me-browser-ci-b9c9` | Fix Functional browsers after Just Me merge — parked / older |
| [#1](https://github.com/snacktrapp/our-days/pull/1) | open | `codex/durable-release-workflow` | Make preview approval the release gate — parked / older |

---

## 7. Closed unmerged — DO NOT REOPEN

| PR | Closed | Merged? | Title |
| --- | --- | --- | --- |
| [#83](https://github.com/snacktrapp/our-days/pull/83) | 2026-09-15 | never | Recolor app theme chrome to Brian expanded palette |
| [#84](https://github.com/snacktrapp/our-days/pull/84) | 2026-09-15 | never | Reapply Our Days palette v2 across light/dark chrome |

Both are closed never-mind. Palette work stays parked until Brian **explicitly** reopens it.

---

## 8. Open / parked product tracks

| Track | Status |
| --- | --- |
| Cold-open / stuck timeline | Heavy Sep 14 merge wave (#76–#82). Still **Brian soak** for residual stuck timeline / interrupt. |
| Whole-app functionality review | Draft **#78** |
| Notifications | **#55 parked** until Brian phone-push GO |
| Palette | **#83 + #84** closed never-mind — do not reopen |
| Circle-switch transition polish | Open / parked |
| Load phone GO | Pending Brian |
| Note + keyboard phone GO | Pending Brian |
| Papa timeline verify | Pending Brian |

---

## 9. Durability / CI ops

- Smash-on-PR plus adversarial cadence.
- Do **not** leave agents spinning ~1h on non-critical CI.
- Anti-spin: when **Quality** is green, interrupt / squash-merge even if only Local Supabase, Intel visual, or Functional browsers are red.
- Cap: one build run + ≤1 short format/lint mop; then **STOP** and report.

---

## 10. Preview / auth ops

- A cold Vercel Preview is **not** a prod login cookie.
- Do **not** ask Brian to sign in on the TARS box just for theme checks.
- Preview OAuth: Supabase Redirect allowlist needs the Preview wildcard.
- Leave `NEXT_PUBLIC_SITE_URL` production-scoped so Preview uses its own origin.
- Details: [`docs/operations/OAUTH_SIGN_IN.md`](./OAUTH_SIGN_IN.md).

---

## 11. Agent roles

| Role | Does | Does not |
| --- | --- | --- |
| **TARS** | Front door. Launches CloudAgents. Undraft / merge GO. | Dual-launch with Cody |
| **Cody** | Watch tip / Quality / Preview. Mid-ping once. Final ping when Quality is green. | Dual-launch CloudAgents |
| **Brian** | Phone soak. Merge decisions. Load / note+keyboard / Papa GO. | Agent smash babysitting |

---

## Out of scope for this checkpoint

Any feature code, palette reopen, #55 work, merges, or live migrations.
