# Phase 1 application-shell evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: candidate checkpoint. The local implementation, webpack production build, and supported-browser suite pass. Final Phase 1 completion still requires the default Turbopack build in unrestricted CI or Vercel, WebKit on a compatible host, and the documented manual zoom/device checks.

## Delivered

- Server-first route group and pages for `/family`, `/people`, `/people/[personId]`, `/settings/family`, `/memories`, `/memories/on-this-day`, `/memories/years/[year]`, `/journal`, and `/sign-in`.
- A deeply readonly, JSON-serializable presentation contract with explicit date-marker, elapsed-gap, moment, and end-message entries plus discriminated photo, thought, location, and milestone variants.
- Fixture copy isolated in `src/fixtures/design-preview/timelines.server.ts`; an ESLint rule prevents components/features from importing fixtures.
- Neutral visual tokens (`teal`, `clay`, `ochre`, `slate`, and `moss`) instead of fixture-person contracts.
- Extracted journal chrome, primary navigation, timeline feed, card renderer, panels, and accessible composer.
- Minimal service worker with an atomic versioned public allowlist, static locked offline fallback, no runtime journal caching, and no forced activation/reload.
- Vitest/Testing Library, Playwright, axe, console/page-error monitoring, network-failure coverage, and pinned Chromium visual baselines.

## Green evidence

| Check                                                         | Result                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, ESLint, TypeScript, unit/component/contract suite | `npm run check`: pass; 16 files and 182 tests                                                                                                                                                                                                                                                                                       |
| Dependency audit                                              | `npm audit --json`: 0 vulnerabilities                                                                                                                                                                                                                                                                                               |
| Production compilation                                        | `npm run build:webpack`: pass with private-artifact scan; protected journal pages are dynamic. The latest managed `npm run build` attempt reached Turbopack but could not bind its internal CSS worker port (`Operation not permitted`), so the default build remains an explicit unrestricted CI/Vercel gate.                      |
| Local browser matrix                                          | `npm run test:e2e`: atomic webpack build and private-artifact scan passed; 138 browser checks passed, 50 intentional project-specific skips, 0 failures                                                                                                                                                                             |
| Engines covered locally                                       | Chromium mobile/short/wide-visual and Firefox mobile functional, composer, 320px, reduced-motion, axe, console, request-failure, navigation, and visual checks                                                                                                                                                                      |
| Privacy boundary                                              | Preview-disabled `/`, `/sign-in`, and every journal route contain no fixture names, places, or timeline payload; responses are private/no-store/noindex                                                                                                                                                                             |
| PWA/cache                                                     | Cache contains exactly six approved public paths, including the CSP-compatible offline stylesheet; `/family`, RSC payloads, fixture content, and runtime media are absent; offline navigation shows the locked document                                                                                                             |
| Accessibility                                                 | Serious/critical axe findings: 0 in Family, personal, People, Family Settings and its short-screen review states, Memories landing, On This Day, year, empty-memory, chooser, written composer, and global-error states                                                                                                             |
| Mobile layout                                                 | No horizontal overflow and no visible target below 44 CSS px at 320×568 in all primary, Settings, and Memories screens; deep actions clear the fixed navigation; 320×350 composer, detail, and Settings review controls remain reachable; the 640×450 CSS viewport equivalent of a 1280×900 window at 200% reflows in one dimension |
| Runtime health                                                | No unexpected console errors, page errors, or request failures in the passing matrix                                                                                                                                                                                                                                                |
| Prepared CI contract                                          | Workflow contract checks pass; the read-only workflow lists all functional projects including WebKit and keeps x64 macOS 15 pixel checks separate. Its first hosted visual run is a reviewed calibration gate, and it remains unexecuted until the isolated GitHub repository is approved.                                          |

The first adversarial browser run exposed a real Next streaming issue: an ancestor layout redirect visually blocked the preview, but the redirect response still included the rendered child RSC model. Every protected page now calls the fail-closed guard before creating its view model. The regression suite captures real preview-enabled Next link navigation envelopes, proves no private RSC is requested before interaction, then replays RSC requests against every locked route and requires a private/no-store/noindex redirect payload with no fixture or media strings. Private-route prefetching is also disabled pending Phase 2 account-isolation tests.

## Automated visual baselines

| Screenshot                                                                    | SHA-256                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `family-chromium-mobile-chromium-mobile-darwin.png`                           | `f71b12842c968feef31ddad5622946e0ac755a73c591c4e1830e2e1fd5503d91` |
| `family-chromium-short-chromium-short-darwin.png`                             | `8ca503ca9a196e2d8e232c09823a361e11e023feb2919d74c6e0b0cf7c75c918` |
| `family-chromium-wide-visual-chromium-wide-visual-darwin.png`                 | `4c031f429fe5d0c0eff36be3debccbb8d851da1bf3414a646e2b7f2fbfe877fc` |
| `personal-chromium-mobile-chromium-mobile-darwin.png`                         | `22d0ba0f8b906766b50aadf9d16cf5e6a7bfbab57abfa47421529c2ed3286acb` |
| `personal-avery-chromium-mobile-chromium-mobile-darwin.png`                   | `94f55a46e95ff8ceb796219b2548989562d1ff39dbcdb2c1ba6771c571d40765` |
| `personal-avery-ending-chromium-mobile-chromium-mobile-darwin.png`            | `92bd5cc3edd6abb7cb9f992546189037f76b5df82a49b3a4b10ee16f8acdbdd2` |
| `personal-sam-empty-chromium-mobile-chromium-mobile-darwin.png`               | `6d07264aa45c79323d4119bd64e6453694c5192fe10baa62cbd311a3bf22c4ac` |
| `composer-chooser-chromium-mobile-chromium-mobile-darwin.png`                 | `55b36b5b8b20e8e8f065f134d454a3c1c759013c4126c723ea03fb4cd31e416a` |
| `composer-written-chromium-mobile-chromium-mobile-darwin.png`                 | `2bbc17652d744cff3c6395dc546ebc6fcc59c4c37318cd8c87b74a0854cefd7c` |
| `composer-review-chromium-mobile-chromium-mobile-darwin.png`                  | `f17d4aa39ede6de465392981cc0570233c4bca22e471c6c720deddeadee74796` |
| `composer-photo-chromium-mobile-chromium-mobile-darwin.png`                   | `68575972d46332cc207aa6ffe7e157c715e425128d2225ca3955caa7f3e7dcf8` |
| `composer-photo-review-chromium-mobile-chromium-mobile-darwin.png`            | `4e3b969353525d61c1582427d95ff092fc12c00aaefe65d97fa4fef4b20f2a83` |
| `composer-milestone-chromium-mobile-chromium-mobile-darwin.png`               | `0c90abfcf2b2c1764a77fac2fe68b07bf7752726d63533347c8094e54a84ac76` |
| `composer-place-chromium-mobile-chromium-mobile-darwin.png`                   | `bfe74dbc18c5ac1703afcb3e47085925a849ab9389273430fdd634459bf024f6` |
| `composer-place-review-chromium-mobile-chromium-mobile-darwin.png`            | `9735e85fcb0b4c02148cc0d0a5136b7c81806e736f0390f2117dd9c0c16743b3` |
| `composer-place-short-chromium-short-darwin.png`                              | `e07a3b2954feb7ace6bd4c2659226eaba36d7ba161b798459d3d3d5fdf28af99` |
| `memories-empty-chromium-mobile-chromium-mobile-darwin.png`                   | `64074336fb9e0900a11b565009550ef2a795c672d2c49bae40bf265522a62a56` |
| `memories-landing-chromium-mobile-chromium-mobile-darwin.png`                 | `1c4d2615049b16cd1ae9376c15bd69aa18305f456e29b744ed2470721e48819e` |
| `memories-landing-viewport-chromium-short-chromium-short-darwin.png`          | `d3ca8e7942a562ed1b368e981564d2540334f5cd6a747305f265d9dba29f1b24` |
| `memories-on-this-day-chromium-mobile-chromium-mobile-darwin.png`             | `99e11de643a278dee86f27d7eb8bb0414ea370a5a50656116822da6888c4c00e` |
| `memories-year-chromium-mobile-chromium-mobile-darwin.png`                    | `dd22c02bc672a6a0b686754bda906ff28548b4067c66490143cfa060de0c1fab` |
| `moment-detail-photo-response-chromium-mobile-chromium-mobile-darwin.png`     | `db4ead285c3640efb52fbdee1a3705a89779448c4881e52fca97c1fbff077d83` |
| `moment-detail-thought-notes-chromium-mobile-chromium-mobile-darwin.png`      | `61ff752324ac6131dc13d943504865f4a0e45603452f1cb83b2e3d4b922225e5` |
| `moment-detail-location-notes-chromium-mobile-chromium-mobile-darwin.png`     | `f34b168aadd6cb8b76f320ba34184db779272874aa297581fe70b1c97506face` |
| `moment-detail-milestone-response-chromium-mobile-chromium-mobile-darwin.png` | `7eaf99b2d9a33117ab92e1ad45f88150fd0bcb050fec4c4439ccf8c904135713` |
| `moment-detail-note-preview-chromium-mobile-chromium-mobile-darwin.png`       | `c276f816408f262aeda17f453dcac6425624c03ea5d9162fb3a3ed6297d2dfab` |
| `moment-detail-short-chromium-short-chromium-short-darwin.png`                | `6425ac13725a9995169c63927a2e8ba30c830ddd0f3a33452b544fdc753ec5bc` |
| `family-settings-chromium-mobile-chromium-mobile-darwin.png`                  | `e04eeb0c5ebe8f62abff198d1e40ec7e44269d9ff749921d23a3ccbdba7dde0b` |
| `family-settings-access-review-chromium-mobile-chromium-mobile-darwin.png`    | `2f1da9efef2b33f14ae532239372fa7eec9485777af9138c3947c50d0d019d21` |
| `family-settings-invite-review-chromium-mobile-chromium-mobile-darwin.png`    | `89ef68297f01a2a1e47a63aba4e1f2ef0ab5fc998ffa10add5eef386efdebe6d` |
| `family-settings-invite-short-chromium-short-chromium-short-darwin.png`       | `a84b92cf1e2ac4001ac353db319c7bbdf48cc374e02e41ed586ee839a4048e48` |

They live in `tests/e2e/visual.spec.ts-snapshots/` and are compared by the pinned Chromium projects.

## Independent review closure

The first architecture and mobile reviews correctly withheld a checkpoint approval. The stable candidate now addresses their actionable findings:

- The timeline and moment cards render on the server; only each moment's notes/responses control retains local client state.
- Chrome consumes a neutral view model, fixture imports are blocked across application code, and People and Memories own their presentation contracts.
- Visual coverage now includes 320px, 390px, 430px, multi-year, sparse, and empty personal timelines, chooser, and written-composer states.
- Composer coverage proves native modal behavior, focus containment and restoration, Escape and backdrop dismissal, draft confirmation, 44px controls, and reachability with a 320×350 keyboard-sized viewport.
- Every browser test monitors unexpected page errors, console errors, and request failures.
- Service-worker contract tests prove a failed update cannot replace the active cache and a successful update removes only older Our Days caches.
- Browser-generated RSC regression tests cover both the ordinary document boundary and the exact streaming request shape that originally exposed fixture data.

Final independent candidate verdicts: architecture **GO**, mobile/accessibility **GO**, and privacy/adversarial **GO**. The reviewers found no current-tree defect that blocks committing this checkpoint. Their remaining concerns are the external evidence gates and later-phase Supabase authorization/media work listed below.

A subsequent full focus-order audit caught a Chromium-only escape from the modal to `document.body` after a complete Tab traversal. The composer now enforces explicit first/last focus boundaries, excludes hidden, disabled, and non-layout controls from that cycle, and full forward plus reverse traversal reaches every chooser and written-composer control without leaving the dialog in Chromium and Firefox. Follow-up architecture, mobile/accessibility, and privacy reviews all returned **GO** with no current-tree blocker.

WebKit execution, true browser zoom, and physical iPhone behavior remain explicit external evidence gates below; they are not represented as passes.

## Open evidence, not hidden passes

- Playwright WebKit 2251 is a frozen macOS 14 build on this host and exits before page creation with `Bus error: 10` (exit 138). The project is retained and mandatory in CI; local opt-in is `PLAYWRIGHT_INCLUDE_WEBKIT=1`.
- The first isolated GitHub run must execute the prepared functional browser projects and calibrate the reviewed local snapshots against the x64 macOS 15 host. The complete CI list contains 247 checks across 10 files, including WebKit and project-specific visual cases. Baseline differences must be inspected and approved; CI never updates them automatically.
- The clean install warns that ESLint 9.39.5 is outside its upstream support window. ESLint 10.9.1 was evaluated, but `eslint-config-next` 16.3.3's bundled import, React, and JSX accessibility plugins still declare ESLint 9 as their maximum supported major. The candidate therefore retains the exact-pinned, zero-advisory ESLint 9 release rather than using peer overrides; upgrade when the complete Next lint stack supports 10.
- Desktop browser 200% zoom/large-text review, nonzero iOS safe areas, real software keyboard/predictive text, VoiceOver, standalone foreground/background, and update behavior require the documented headed/real-device passes.
- The current service worker deliberately provides only a public locked offline experience. Authenticated state purge and two-account isolation belong to Phase 2, when account-scoped state exists.
