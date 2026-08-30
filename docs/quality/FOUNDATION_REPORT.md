# Foundation verification report

Date: 2026-08-29 (America/Los_Angeles)

## Automated results

| Check | Result | Evidence |
| --- | --- | --- |
| ESLint | Pass | `npm run lint` |
| TypeScript | Pass | `npm run typecheck` |
| Production compilation | Pass | Default `npm run build` on Next.js 16.3.3/Turbopack after a clean install; root is dynamic and other metadata routes are static |
| Dependency audit | Pass | `npm audit --json`: 0 vulnerabilities after upgrading Next.js 16.2.6 → 16.3.3 |
| Browser load | Pass | Production `next start`: meaningful body, no Next error overlay, no page errors |
| Fail-closed production root | Pass | Without the local design flag: invitation-only entry present, fixture leak list empty, and no `.timeline`; private/no-store and noindex/noarchive headers present |
| WCAG automation | Pass in scanned states | axe-core 4.12.1: 0 violations in Family, Molly, People, Memories, composer chooser, and written composer; gradient/image cases remain manual review |
| Hit targets | Pass in scanned states | Browser bounding-box query returned no visible button below 44×44 in Family, Molly, People, Memories, or composer states |
| Composer focus | Pass | Native modal opens with focus on first moment type; Shift+Tab stays inside; Escape closes; focus returns to Add Moment |
| Short keyboard viewport | Pass in simulation | At 320×350, written composer client height 338 and scroll height 412; Save remains reachable |

## Visual baselines

- `baseline-320x568.png` — short phone family timeline
- `baseline-390x844.png` — primary phone family timeline
- `baseline-430x932.png` — large phone family timeline
- `individual-molly-390x844.png` — individual journal treatment
- `composer-320x568.png` — moment-type chooser on a short phone
- `composer-keyboard-320x350.png` — written form scrolled to Save with a simulated keyboard-shortened viewport

The installed-app icon now uses the central rail with three family-colored nodes and remains inside the maskable safe area.

### Capture provenance

- Build: Next.js 16.3.3 default Turbopack build, served by `next start` with the local-only design-review flag
- Browser: HeadlessChrome 152.0.0.0 on macOS; device pixel ratio 1
- Fixture SHA-256: `847c0b7d2a271cfc12c5fec3389118a54cc6d2feb81a2c0869bc9675c9ff40a6`
- Fixture origin and publication gate: `docs/quality/FIXTURE_PROVENANCE.md`

| Screenshot | SHA-256 |
| --- | --- |
| `baseline-320x568.png` | `35d230fb60d2e55e4bc7f5e968d45f91e25656b1f8336dbdfb4ed83631b48c41` |
| `baseline-390x844.png` | `6db3645367371dbd933df63f8716a4bccd840962c6d9a6880103eb1f3fbbfc37` |
| `baseline-430x932.png` | `b8f2d37641c0cb0e839faceb83dade921ca786d3d6898b461d564b0810851673` |
| `individual-molly-390x844.png` | `42d1e928635ab75ff6f7ad3972f0afb23c5d8af6a36443ff16b5e24269b755e9` |
| `composer-320x568.png` | `6a25b82f0db9992260cd1cfe3fcae1e1ab0cdf72edcc76d069752e52d6dafe6b` |
| `composer-keyboard-320x350.png` | `79e5f636b1f522aa218f7072ba247fb15b54076c026a6fa85c794abc89fa3b3f` |

## Fixed review findings

- Added `viewport-fit=cover`, top safe-area spacing, and bottom-nav paint through the home-indicator region.
- Replaced the visual pseudo-dialog with a native modal dialog, body scroll lock, initial focus, focus containment, Escape handling, focus restoration, and draft-discard confirmation.
- Made the sheet internally scrollable using dynamic viewport height and kept text entry at 17px to avoid Safari auto-zoom.
- Raised current primary controls to 44×44px hit areas and added visible focus rings; the ad hoc bounding-box assertion becomes a checked-in Phase 1 test.
- Corrected the detected contrast violations (14 serious Family-state nodes to zero) and scanned all currently reachable shell/composer states; gradient/image cases still need manual and durable test coverage.
- Replaced incomplete tab semantics with a labeled pressed-button group.
- Added moment-specific action names, machine-readable dates, `aria-current`, and hidden decorative symbols.
- Added reduced-motion handling for the sheet.
- Replaced remote stock-media requests with a local non-personal fixture.

## Required later evidence

Headless Chromium cannot prove iOS safe-area, real keyboard, photo-picker, VoiceOver, background/foreground, installed-PWA update, or sign-out cache behavior. Those remain release-candidate gates on real current and short-screen iPhones. Private-media cache assertions begin only after authenticated media exists.

The current Next ESLint stack still pins ESLint 9 because the bundled import/React/accessibility plugins do not yet declare ESLint 10 compatibility; npm marks ESLint 9 deprecated. Recheck this on the next Next/plugin upgrade. npm 11 also labels two lockfile-listed optional Sharp/WASM artifacts as extraneous after a clean install; they are reproducibly created by `npm ci`, are not direct dependencies, and the audited default build passes.
