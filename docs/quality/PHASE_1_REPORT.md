# Phase 1 application-shell evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: candidate checkpoint. The local implementation, webpack production build, and supported-browser suite pass. Final Phase 1 completion still requires the default Turbopack build in unrestricted CI or Vercel, WebKit on a compatible host, and the documented manual zoom/device checks.

## Delivered

- Server-first route group and pages for `/family`, `/people`, `/people/[personId]`, `/memories`, `/memories/on-this-day`, `/memories/years/[year]`, `/journal`, and `/sign-in`.
- A deeply readonly, JSON-serializable presentation contract with explicit date-marker, elapsed-gap, moment, and end-message entries plus discriminated photo, thought, location, and milestone variants.
- Fixture copy isolated in `src/fixtures/design-preview/timelines.server.ts`; an ESLint rule prevents components/features from importing fixtures.
- Neutral visual tokens (`teal`, `clay`, `ochre`, `slate`, and `moss`) instead of fixture-person contracts.
- Extracted journal chrome, primary navigation, timeline feed, card renderer, panels, and accessible composer.
- Minimal service worker with an atomic versioned public allowlist, static locked offline fallback, no runtime journal caching, and no forced activation/reload.
- Vitest/Testing Library, Playwright, axe, console/page-error monitoring, network-failure coverage, and pinned Chromium visual baselines.

## Green evidence

| Check                                                         | Result                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formatting, ESLint, TypeScript, unit/component/contract suite | `npm run check`: pass; 14 files and 168 tests                                                                                                                                                                                                                                               |
| Dependency audit                                              | `npm audit --json`: 0 vulnerabilities                                                                                                                                                                                                                                                      |
| Production compilation                                        | `npm run build:webpack`: pass with private-artifact scan; protected journal pages are dynamic. The latest managed `npm run build` attempt reached Turbopack but could not bind its internal CSS worker port (`Operation not permitted`), so the default build remains an explicit unrestricted CI/Vercel gate.                         |
| Local browser matrix                                          | `npm run test:e2e`: atomic webpack build and private-artifact scan passed; 79 browser checks passed, 29 intentional project-specific skips, 0 failures                                                                                                                                       |
| Engines covered locally                                       | Chromium mobile/short/wide-visual and Firefox mobile functional, composer, 320px, reduced-motion, axe, console, request-failure, navigation, and visual checks                                                                                                                             |
| Privacy boundary                                              | Preview-disabled `/`, `/sign-in`, and every journal route contain no fixture names, places, or timeline payload; responses are private/no-store/noindex                                                                                                                                    |
| PWA/cache                                                     | Cache contains exactly six approved public paths, including the CSP-compatible offline stylesheet; `/family`, RSC payloads, fixture content, and runtime media are absent; offline navigation shows the locked document                                                                   |
| Accessibility                                                 | Serious/critical axe findings: 0 in Family, personal, People, Memories landing, On This Day, year, empty-memory, chooser, written composer, and global-error states                                                                                                                          |
| Mobile layout                                                 | No horizontal overflow and no visible target below 44 CSS px at 320×568 in all primary and Memories screens; deep timeline actions clear the fixed navigation; 320×350 composer controls remain reachable; the 640×450 CSS viewport equivalent of a 1280×900 window at 200% reflows in one dimension |
| Runtime health                                                | No unexpected console errors, page errors, or request failures in the passing matrix                                                                                                                                                                                                       |
| Prepared CI contract                                          | Workflow contract checks pass; the read-only workflow lists all functional projects including WebKit and keeps x64 macOS 15 pixel checks separate. Its first hosted visual run is a reviewed calibration gate, and it remains unexecuted until the isolated GitHub repository is approved. |

The first adversarial browser run exposed a real Next streaming issue: an ancestor layout redirect visually blocked the preview, but the redirect response still included the rendered child RSC model. Every protected page now calls the fail-closed guard before creating its view model. The regression suite captures real preview-enabled Next link navigation envelopes, proves no private RSC is requested before interaction, then replays RSC requests against every locked route and requires a private/no-store/noindex redirect payload with no fixture or media strings. Private-route prefetching is also disabled pending Phase 2 account-isolation tests.

## Automated visual baselines

| Screenshot                                                    | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `family-chromium-mobile-chromium-mobile-darwin.png`           | `b000532682bece41635194ce920fe012adf223c7c0e300c97da9d7060fefd004` |
| `family-chromium-short-chromium-short-darwin.png`             | `9cf39cb6ff1dd46d64e2cfb645aa2689b63f4775f06ec5aea6f4d3f3b7cb0d02` |
| `family-chromium-wide-visual-chromium-wide-visual-darwin.png` | `cf366b79e65c639a66fde0496d1da54c14a1395f0ddd9356c42d9ba43b7ee72b` |
| `personal-chromium-mobile-chromium-mobile-darwin.png`         | `1ddb26e08fa40bb455c6d9e7eb7e0eaf2f98d6efca63bd79be51290f813e54dd` |
| `composer-chooser-chromium-mobile-chromium-mobile-darwin.png` | `55b36b5b8b20e8e8f065f134d454a3c1c759013c4126c723ea03fb4cd31e416a` |
| `composer-written-chromium-mobile-chromium-mobile-darwin.png` | `279834775b9028e85cc66d646c1593ec08377eb292dad641b91298abf8f17b02` |
| `composer-review-chromium-mobile-chromium-mobile-darwin.png` | `b2491451c82ac030d7754a3f8555bdb9eb1d7e2d09be3e3bfec7b9bcf0a67bac` |
| `composer-photo-chromium-mobile-chromium-mobile-darwin.png` | `c2adc22e5d6d8eb517fe322f76a21b12d91f78e11ccd9a16998fd45d5dc2fd47` |
| `composer-photo-review-chromium-mobile-chromium-mobile-darwin.png` | `4e3b969353525d61c1582427d95ff092fc12c00aaefe65d97fa4fef4b20f2a83` |
| `composer-milestone-chromium-mobile-chromium-mobile-darwin.png` | `0c90abfcf2b2c1764a77fac2fe68b07bf7752726d63533347c8094e54a84ac76` |
| `composer-place-chromium-mobile-chromium-mobile-darwin.png` | `13a139e185ce86558f2b55f9c6683813b548d42c49f3ba8d845deb67c0e88ecd` |
| `composer-place-review-chromium-mobile-chromium-mobile-darwin.png` | `9735e85fcb0b4c02148cc0d0a5136b7c81806e736f0390f2117dd9c0c16743b3` |
| `composer-place-short-chromium-short-darwin.png` | `e07a3b2954feb7ace6bd4c2659226eaba36d7ba161b798459d3d3d5fdf28af99` |
| `memories-empty-chromium-mobile-chromium-mobile-darwin.png` | `64074336fb9e0900a11b565009550ef2a795c672d2c49bae40bf265522a62a56` |
| `memories-landing-chromium-mobile-chromium-mobile-darwin.png` | `1c4d2615049b16cd1ae9376c15bd69aa18305f456e29b744ed2470721e48819e` |
| `memories-landing-viewport-chromium-short-chromium-short-darwin.png` | `d3ca8e7942a562ed1b368e981564d2540334f5cd6a747305f265d9dba29f1b24` |
| `memories-on-this-day-chromium-mobile-chromium-mobile-darwin.png` | `b7261eaddaf1e2a9065b5cfa860b77a317a94c7526f5acd257ca05bb2557f482` |
| `memories-year-chromium-mobile-chromium-mobile-darwin.png` | `2bc3742129a963a05b3269d6bc209638558f3918434ee7c44514efbc90dfef62` |

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

A subsequent full focus-order audit caught a Chromium-only escape from the modal to `document.body` after a complete Tab traversal. The composer now enforces explicit first/last focus boundaries, excludes hidden, disabled, and non-layout controls from that cycle, and full forward plus reverse traversal reaches every chooser and written-composer control without leaving the dialog in Chromium and Firefox. Follow-up architecture, mobile/accessibility, and privacy reviews all returned **GO** with no current-tree blocker.

WebKit execution, true browser zoom, and physical iPhone behavior remain explicit external evidence gates below; they are not represented as passes.

## Open evidence, not hidden passes

- Playwright WebKit 2251 is a frozen macOS 14 build on this host and exits before page creation with `Bus error: 10` (exit 138). The project is retained and mandatory in CI; local opt-in is `PLAYWRIGHT_INCLUDE_WEBKIT=1`.
- The first isolated GitHub run must execute the prepared functional browser projects and calibrate the reviewed local snapshots against the x64 macOS 15 host. The complete CI list contains 142 checks across 7 files, including WebKit and project-specific visual cases. Baseline differences must be inspected and approved; CI never updates them automatically.
- The clean install warns that ESLint 9.39.5 is outside its upstream support window. ESLint 10.9.1 was evaluated, but `eslint-config-next` 16.3.3's bundled import, React, and JSX accessibility plugins still declare ESLint 9 as their maximum supported major. The candidate therefore retains the exact-pinned, zero-advisory ESLint 9 release rather than using peer overrides; upgrade when the complete Next lint stack supports 10.
- Desktop browser 200% zoom/large-text review, nonzero iOS safe areas, real software keyboard/predictive text, VoiceOver, standalone foreground/background, and update behavior require the documented headed/real-device passes.
- The current service worker deliberately provides only a public locked offline experience. Authenticated state purge and two-account isolation belong to Phase 2, when account-scoped state exists.
