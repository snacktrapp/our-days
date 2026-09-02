# Our Days

Our Days is a private, mobile-first family journal built around a chronological center-line timeline. This is the isolated production repository; it must never share Proof's GitHub, Supabase, Vercel, environment variables, domains, or data.

The current route-based shell preserves the approved interactive design baseline. Backend/auth work intentionally follows the privacy and acceptance gates in `docs/`.

The default local path now runs that same product without Docker Desktop or the multi-container Supabase Studio stack. Sign-in, written moments, and photo/video coordinators use a file-backed local journal; hosted Supabase remains the production backend.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. The public gate is the same invitation-only sign-in screen as production. For the local journal, use `family@example.com` (a synthetic organizer, not a production family member). Data stays in `.data/our-days-local/`.

Requires Node.js 22 or newer. `.node-version` pins the locally verified and CI runtime; the checked-in package lock is authoritative.

The Phase 2 database foundation is local and unlinked. It is optional and not on the happy path. Running it requires a Docker-compatible container runtime, then:

```bash
npm run supabase:start
npm run db:reset
npm run test:db
npm run test:auth:integration
npm run test:photo:integration
npm run test:db:concurrency
npm run test:photo:derivative:concurrency
npm run test:db:restore
npm run types:db:check
npm run test:browser:connected
npm run db:lint
```

`supabase/config.toml` disables open signup and automatic Data API exposure. The local seed is synthetic and spans two circles, including revoked and no-circle actors. The integration commands exercise real local Auth, OTP email, invitation preflight/acceptance, revocation, private Storage denial, bounded photo quarantine, immutable original promotion, private display derivation, provably overlapping concurrency, fragment/cookie lifecycle, hostile-origin denial, browser-state cleanup, generated schema types, and same-container logical database fidelity; reset-owning integration commands restore the synthetic fixtures afterward. Phase 4A binds a declared SHA-256, byte count, and MIME type to an exact claimed quarantine path and permits only ordinary-JWT TUS create/part requests. Phase 4B validates the complete bytes inside a private spool and promotes that exact stream to a fresh immutable browser-unwritable original. Phase 4C revalidates that original, applies orientation, strips metadata, produces a fixed-profile WebP at a fresh attempt path, re-downloads and verifies it, and records an immutable private derivative. The connected photo path now invokes that validation from a same-origin Node route, publishes the verified derivative to both family and individual timelines, and serves it through the viewer's ordinary family session. Processing uses a dedicated allowlisted Supabase Auth identity with no family membership; the web deployment still receives no secret/service-role key. Durable quarantine cleanup execution, export/deletion reconciliation, hosted recovery, and media-byte backup remain explicit production follow-ups. Direct TUS avoids Vercel's 4.5 MiB request-body limit for original-quality photos. `test:db:restore` never resets or writes to its canonical source database: run `npm run db:reset` separately first, then the drill fails closed unless that source exactly matches the reviewed, committed synthetic fixture. It must never target a linked, hosted, or real-data project. It does not cover Storage object bytes or production disaster recovery; see `docs/operations/LOCAL_RECOVERY_DRILL.md`. Login-capable integration users are provisioned only by a test-only local bootstrap boundary.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm audit
npm run check
npm run test:e2e
```

In this restricted development environment, Turbopack can be prevented from binding its internal CSS worker port; use `npm run build:webpack` for a fallback local production-build check. CI and Vercel still run the default build. Local WebKit is opt-in with `PLAYWRIGHT_INCLUDE_WEBKIT=1`; the prepared CI workflow always includes it.

`.github/workflows/ci.yml` is committed locally but cannot run until the separate GitHub repository is explicitly approved and created. It uses a read-only token, immutable GitHub-owned action SHAs, no secrets or dependency cache, Linux functional checks across Chromium/Firefox/WebKit, and x64 macOS 15 visual comparisons. Each repository production-build script atomically follows compilation with a redacting credential/private-fixture scan. The first hosted visual run is a calibration gate because screenshot rendering can differ by host OS; any new baseline must be reviewed rather than automatically accepted. Browser traces, screenshots, and HTML reports are intentionally not uploaded because future authenticated runs may contain private family data.

`next.config.ts` validates the resource identity before Next starts or builds. Unmanaged local commands default to a resource-free local mode; CI declares that mode explicitly. Any future Preview or Production deployment must declare its environment, HTTPS site origin, trusted Production origin, expected and Production Supabase project references, known forbidden Proof references, matching Supabase base URL, and current publishable key. Preview cannot use the Production origin or project. The web process rejects legacy/alternate Supabase connection variables, management tokens, secret/service-role credentials, JWT secrets, and direct database credentials by both name and sensitive value pattern. See `docs/quality/ENVIRONMENT_ISOLATION_REPORT.md`.

`npm run verify:artifacts` requires a completed production build, scans tracked plus untracked non-ignored source and the complete `.next` tree, and emits only redacted findings. It also checks public files, static assets, standalone client assets, and prerendered browser responses for local design-fixture canaries. See `docs/quality/PRIVATE_ARTIFACT_SCAN_REPORT.md` for coverage and limitations.

Rendered pages use a fresh nonce CSP and request-time rendering. Production allows no unauthorized inline script, event handler, style attribute, frame, plugin, wildcard Supabase host, analytics origin, or third-party reporting collector. Known public assets stay outside the nonce proxy but retain the static isolation-header baseline; HSTS is Production-only. See `docs/quality/SECURITY_HEADERS_REPORT.md`.

## Durable project documents

- `docs/product/PRODUCT_BRIEF.md` — product promise, MVP, flows, model, and initial technical direction
- `docs/architecture/DECISIONS.md` — locked and pending decisions
- `docs/architecture/PHASES.md` — small delivery slices and their gates
- `docs/architecture/ACCEPTANCE_CRITERIA.md` — release-blocking requirements
- `docs/privacy/THREAT_MODEL.md` — assets, adversaries, boundaries, and mitigations
- `docs/quality/PHASE_1_REPORT.md` — current component/browser evidence and open device/CI gates
- `docs/quality/PHASE_2_CHECKPOINT_REPORT.md` — executable local Auth/database/browser evidence and remaining production gates
- `docs/quality/PHASE_2B_INVITATION_JOB_FOUNDATION_REPORT.md` — private invitation-job ledger, disabled worker contract, adversarial review, and remaining delivery gates
- `docs/quality/MEMORIES_PREVIEW_REPORT.md` — date browsing preview evidence and production limits
- `docs/quality/CAPTURE_PREVIEW_REPORT.md` — local capture contract, privacy proof, and production limits
- `docs/quality/MOMENT_DETAIL_PREVIEW_REPORT.md` — count-free notes/responses contract and privacy proof
- `docs/quality/FAMILY_SETTINGS_PREVIEW_REPORT.md` — invitation/access preview contract and privacy proof
- `docs/quality/PERSONAL_JOURNALS_PREVIEW_REPORT.md` — individual journal ownership, empty-state, and route privacy evidence
- `docs/quality/VIDEO_FEASIBILITY_REPORT.md` — isolated local short-video treatment, lifecycle evidence, and production stop/defer gates
- `docs/quality/PHASE_4A_PHOTO_INTAKE_FOUNDATION_REPORT.md` — fingerprint-bound direct-TUS quarantine contract, concurrency limitation, and immutable-promotion gates
- `docs/quality/PHASE_4B_IMMUTABLE_PHOTO_PROMOTION_REPORT.md` — isolated byte validation, immutable original promotion, adversarial races, and remaining media gates
- `docs/quality/PHASE_4C_PRIVATE_PHOTO_DERIVATIVE_REPORT.md` — orientation-correct metadata-safe private display derivation and remaining delivery gates
- `docs/quality/PHASE_7A_EXPORT_FOUNDATION_REPORT.md` — private export-request ledger, zero-media archive contract, adversarial review, and remaining worker gates
- `docs/quality/PHASE_7B_MEMBERSHIP_ATTRIBUTION_REPORT.md` — durable membership-based moment attribution, upgrade rehearsal, and remaining account-closure gates
- `docs/quality/PHASE_7C_ACCOUNT_CLOSURE_PREPARATION_REPORT.md` — private closure intent, atomic all-circle access detachment, and remaining external-deletion gates
- `docs/quality/PHASE_8A_LOCAL_RECOVERY_FOUNDATION_REPORT.md` — same-container synthetic database restore evidence and remaining production recovery gates
- `docs/operations/LOCAL_RECOVERY_DRILL.md` — destructive local-fixture drill procedure, safety boundary, and production recovery prerequisites
- `docs/quality/PRIVATE_ARTIFACT_SCAN_REPORT.md` — credential and private client-artifact gate
- `docs/quality/SECURITY_HEADERS_REPORT.md` — nonce CSP and browser isolation evidence

## Deployment boundary

Do not link or deploy this repository until Brian approves creation of the dedicated GitHub, Supabase, and Vercel resources. Preview environments must never point at production family data. Until invitation auth exists, any external preview also requires Vercel Deployment Protection; the default production route is fail-closed and does not render the fixture timeline. The local fixture bypass is accepted only with an explicit flag, local/detached identity, and a loopback site origin.

The staging, approval, promotion, rollback, and production smoke-test procedure is documented in `docs/operations/RELEASE_WORKFLOW.md`. `npm run release:state` rejects a dirty worktree, an unapproved branch, or a missing/non-GitHub `origin`; `npm run release:verify` then runs the complete local release gate without deploying anything.
