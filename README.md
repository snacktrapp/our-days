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

Requires Node.js 22 or newer. The checked-in package lock is authoritative.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm audit
npm run check
npm run test:e2e
```

In this restricted development environment, Turbopack can be prevented from binding its internal CSS worker port; use `npm run build:webpack` for the local production-build check. CI and Vercel must still run the default build. Local WebKit is opt-in with `PLAYWRIGHT_INCLUDE_WEBKIT=1`; unrestricted CI always includes it.

## Durable project documents

- `docs/product/PRODUCT_BRIEF.md` — product promise, MVP, flows, model, and initial technical direction
- `docs/architecture/DECISIONS.md` — locked and pending decisions
- `docs/architecture/PHASES.md` — small delivery slices and their gates
- `docs/architecture/ACCEPTANCE_CRITERIA.md` — release-blocking requirements
- `docs/privacy/THREAT_MODEL.md` — assets, adversaries, boundaries, and mitigations
- `docs/quality/PHASE_1_REPORT.md` — current component/browser evidence and open device/CI gates

## Deployment boundary

Do not link or deploy this repository until Brian approves creation of the dedicated GitHub, Supabase, and Vercel resources. Preview environments must never point at production family data. Until invitation auth exists, any external preview also requires Vercel Deployment Protection; the default production route is fail-closed and does not render the fixture timeline.
