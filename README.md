# Our Days

Our Days is a private, mobile-first family journal built around a chronological center-line timeline. This is the isolated production repository; it must never share Proof's GitHub, Supabase, Vercel, environment variables, domains, or data.

The current route-based shell preserves the approved interactive design baseline. Backend/auth work intentionally follows the privacy and acceptance gates in `docs/`.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>; local development redirects the locked root to `/family` for design work.

Requires Node.js 22 or newer. `.node-version` pins the locally verified and CI runtime; the checked-in package lock is authoritative.

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
- `docs/quality/MEMORIES_PREVIEW_REPORT.md` — date browsing preview evidence and production limits
- `docs/quality/CAPTURE_PREVIEW_REPORT.md` — local capture contract, privacy proof, and production limits
- `docs/quality/MOMENT_DETAIL_PREVIEW_REPORT.md` — count-free notes/responses contract and privacy proof
- `docs/quality/FAMILY_SETTINGS_PREVIEW_REPORT.md` — invitation/access preview contract and privacy proof
- `docs/quality/PERSONAL_JOURNALS_PREVIEW_REPORT.md` — individual journal ownership, empty-state, and route privacy evidence
- `docs/quality/PRIVATE_ARTIFACT_SCAN_REPORT.md` — credential and private client-artifact gate
- `docs/quality/SECURITY_HEADERS_REPORT.md` — nonce CSP and browser isolation evidence

## Deployment boundary

Do not link or deploy this repository until Brian approves creation of the dedicated GitHub, Supabase, and Vercel resources. Preview environments must never point at production family data. Until invitation auth exists, any external preview also requires Vercel Deployment Protection; the default production route is fail-closed and does not render the fixture timeline. The local fixture bypass is accepted only with an explicit flag, local/detached identity, and a loopback site origin.
