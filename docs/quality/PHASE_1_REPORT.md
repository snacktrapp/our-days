# Phase 1 application-shell evidence

Date: 2026-08-29 (America/Los_Angeles)

Status: candidate checkpoint. The local implementation, default production build, and supported-browser suite pass. Final Phase 1 completion still requires WebKit on a compatible host and the documented manual zoom/device checks.

## Delivered

- Server-first route group and pages for `/family`, `/people`, `/people/[personId]`, `/memories`, `/journal`, and `/sign-in`.
- A deeply readonly, JSON-serializable presentation contract with explicit date-marker, elapsed-gap, moment, and end-message entries plus discriminated photo, thought, location, and milestone variants.
- Fixture copy isolated in `src/fixtures/design-preview/timelines.server.ts`; an ESLint rule prevents components/features from importing fixtures.
- Neutral visual tokens (`teal`, `clay`, `ochre`, `slate`, and `moss`) instead of fixture-person contracts.
- Extracted journal chrome, primary navigation, timeline feed, card renderer, panels, and accessible composer.
- Minimal service worker with an atomic versioned public allowlist, static locked offline fallback, no runtime journal caching, and no forced activation/reload.
- Vitest/Testing Library, Playwright, axe, console/page-error monitoring, network-failure coverage, and pinned Chromium visual baselines.

## Green evidence

| Check | Result |
| --- | --- |
| Formatting, ESLint, TypeScript, unit/component suite | `npm run check`: pass; 4 files and 10 tests |
| Dependency audit | `npm audit --json`: 0 vulnerabilities |
| Production compilation | `npm run build`: pass with default Turbopack; `npm run build:webpack`: pass; protected journal pages are dynamic |
| Local browser matrix | `npx playwright test`: 44 passed, 13 intentional project-specific skips, 0 failures |
| Engines covered locally | Chromium mobile/short/wide-visual and Firefox mobile functional, composer, 320px, reduced-motion, axe, console, request-failure, navigation, and visual checks |
| Privacy boundary | Preview-disabled `/`, `/sign-in`, and every journal route contain no fixture names, places, or timeline payload; responses are private/no-store/noindex |
| PWA/cache | Cache contains exactly five approved public paths; `/family`, RSC payloads, fixture content, and runtime media are absent; offline navigation shows the locked document |
| Accessibility | Serious/critical axe findings: 0 in Family, personal, People, Memories, chooser, and written composer states |
| Mobile layout | No horizontal overflow and no visible target below 44 CSS px at 320×568 in all primary screens; 320×350 composer controls remain reachable; the 640×450 CSS viewport equivalent of a 1280×900 window at 200% browser zoom reflows in one dimension |
| Runtime health | No unexpected console errors, page errors, or request failures in the passing matrix |

The first adversarial browser run exposed a real Next streaming issue: an ancestor layout redirect visually blocked the preview, but the redirect response still included the rendered child RSC model. Every protected page now calls the fail-closed guard before creating its view model. The regression suite captures real preview-enabled Next link navigation envelopes, proves no private RSC is requested before interaction, then replays RSC requests against every locked route and requires a private/no-store/noindex redirect payload with no fixture or media strings. Private-route prefetching is also disabled pending Phase 2 account-isolation tests.

## Automated visual baselines

| Screenshot | SHA-256 |
| --- | --- |
| `family-chromium-mobile-chromium-mobile-darwin.png` | `3d8ed52cf71afa71365818074cf3616fde5b65871cae1e830e16c7e894bd614d` |
| `family-chromium-short-chromium-short-darwin.png` | `dc261da60f90a5ff475abad6022dcdfa0473ab2826d5a5e6028b45fe97187852` |
| `family-chromium-wide-visual-chromium-wide-visual-darwin.png` | `2c531778866027465c43f5e830ca4bd0fe363bcd6acd752d3abfd2db8b647972` |
| `personal-chromium-mobile-chromium-mobile-darwin.png` | `f0aad9e6a38ccd36d0132aa652590a0a1d7ed97f735d564d7c7435ce2fad01ec` |
| `composer-chooser-chromium-mobile-chromium-mobile-darwin.png` | `8040cdef49f3aca00fbcc8790ce67d540d5d13755bc8dadd060baf1bc099e88d` |
| `composer-written-chromium-mobile-chromium-mobile-darwin.png` | `cb2185638c5d8313c1c5c62bf436fedf353e9c83b44a81393e2e15ef98e2727a` |

They live in `tests/e2e/visual.spec.ts-snapshots/` and are compared by the pinned Chromium projects.

## Independent review closure

The first architecture and mobile reviews correctly withheld a checkpoint approval. The stable candidate now addresses their actionable findings:

- The timeline and moment cards render on the server; only each reaction control retains local client state.
- Chrome consumes a neutral view model, fixture imports are blocked across application code, and People and Memories own their presentation contracts.
- Visual coverage now includes 320px, 390px, 430px, personal-timeline, chooser, and written-composer states.
- Composer coverage proves native modal behavior, focus containment and restoration, Escape and backdrop dismissal, draft confirmation, 44px controls, and reachability with a 320×350 keyboard-sized viewport.
- Every browser test monitors unexpected page errors, console errors, and request failures.
- Service-worker contract tests prove a failed update cannot replace the active cache and a successful update removes only older Our Days caches.
- Browser-generated RSC regression tests cover both the ordinary document boundary and the exact streaming request shape that originally exposed fixture data.

Final independent candidate verdicts: architecture **GO**, mobile/accessibility **GO**, and privacy/adversarial **GO**. The reviewers found no current-tree defect that blocks committing this checkpoint. Their remaining concerns are the external evidence gates and later-phase Supabase authorization/media work listed below.

WebKit execution, true browser zoom, and physical iPhone behavior remain explicit external evidence gates below; they are not represented as passes.

## Open evidence, not hidden passes

- Playwright WebKit 2251 is a frozen macOS 14 build on this host and exits before page creation with `Bus error: 10` (exit 138). The project is retained and mandatory in CI; local opt-in is `PLAYWRIGHT_INCLUDE_WEBKIT=1`.
- The clean install warns that ESLint 9.39.5 is outside its upstream support window. ESLint 10.9.1 was evaluated, but `eslint-config-next` 16.3.3's bundled import, React, and JSX accessibility plugins still declare ESLint 9 as their maximum supported major. The candidate therefore retains the exact-pinned, zero-advisory ESLint 9 release rather than using peer overrides; upgrade when the complete Next lint stack supports 10.
- Desktop browser 200% zoom/large-text review, nonzero iOS safe areas, real software keyboard/predictive text, VoiceOver, standalone foreground/background, and update behavior require the documented headed/real-device passes.
- The current service worker deliberately provides only a public locked offline experience. Authenticated state purge and two-account isolation belong to Phase 2, when account-scoped state exists.
