# Our Days

Our Days is a private, mobile-first family journal built around a chronological center-line timeline. This is the isolated production repository; it must never share Proof's GitHub, Supabase, Vercel, environment variables, domains, or data.

The current screen is the approved interactive design baseline. Backend/auth work intentionally follows the privacy and acceptance gates in `docs/`.

## Local development

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

Requires Node.js 22 or newer. The checked-in package lock is authoritative.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm audit
```

In this restricted development environment, Turbopack cannot bind its internal CSS worker port; use `npm run build -- --webpack` for the local production-build check. CI and Vercel must still run the default build.

## Durable project documents

- `docs/product/PRODUCT_BRIEF.md` — product promise, MVP, flows, model, and initial technical direction
- `docs/architecture/DECISIONS.md` — locked and pending decisions
- `docs/architecture/PHASES.md` — small delivery slices and their gates
- `docs/architecture/ACCEPTANCE_CRITERIA.md` — release-blocking requirements
- `docs/privacy/THREAT_MODEL.md` — assets, adversaries, boundaries, and mitigations

## Deployment boundary

Do not link or deploy this repository until Brian approves creation of the dedicated GitHub, Supabase, and Vercel resources. Preview environments must never point at production family data. Until invitation auth exists, any external preview also requires Vercel Deployment Protection; the default production route is fail-closed and does not render the fixture timeline.
