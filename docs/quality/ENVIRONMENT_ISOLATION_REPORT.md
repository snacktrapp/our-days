# Environment-isolation contract

Date: 2026-08-29 (America/Los_Angeles)

Status: local contract implemented. No Supabase, GitHub, or Vercel resource has been created or connected.

## Boundary

`config/our-days-environment.ts` executes from `next.config.ts`, before a Next development server or production build can load application routes. The root metadata resolver consumes the same normalized result rather than maintaining a second origin policy. The validator returns only normalized non-secret identity fields and throws an `OurDaysEnvironmentError` that names invalid variables without echoing their values.

Unmanaged local commands may default to `local` plus `detached`, which contains no Supabase connection values. GitHub CI declares the same synthetic mode explicitly. Detached mode is rejected for Preview and Production.

The fixture design-preview bypass is separately fail-closed. It requires `OUR_DAYS_ENABLE_DESIGN_PREVIEW=true`, local identity, detached resources, and an explicit clean loopback site origin. There is no implicit `NODE_ENV=development` exception. Startup validation and the runtime route guard share the same pure policy, and direct tests deny missing identity/origin, non-loopback binding, hosted Preview, Supabase mode, and origin paths.

When `OUR_DAYS_RESOURCE_MODE=supabase` is eventually enabled, the contract requires:

- `OUR_DAYS_ENVIRONMENT` matching `VERCEL_ENV` when Vercel declares one;
- an origin-only site URL, with HTTPS mandatory outside local development;
- the trusted Production origin, with Preview required to differ and Production required to match;
- an expected 20-character Supabase project reference;
- a base Supabase URL whose hostname encodes the same reference;
- a current `sb_publishable_` browser key;
- the Production reference in Preview and Production;
- a comma-separated denylist containing every known Proof project reference;
- Preview and Production to use different project references.

The ordinary web process fails if it contains alternate/legacy Supabase connection variables, a Supabase management token, secret/service-role or signing/private key, Supabase JWT secret, Supabase database URL/password, Postgres/libpq connection fields, or generic/direct database URL. Detection covers canonical and prefixed variable names plus `sb_secret_`, `sbp_`, Postgres URI, PEM private-key, and decoded service-role JWT value patterns. A future worker may receive narrow bypass credentials only in a separate deployment after its own import-boundary and artifact tests exist.

## Executable evidence

`tests/contracts/environment-isolation.test.ts` covers:

- explicit local detached success;
- safe local defaults that are not applied to managed CI/Vercel execution;
- valid isolated Preview and Production bindings;
- Preview/Production site-origin separation;
- missing and contradictory environment identity;
- detached hosted deployment denial;
- expected-reference/base-URL mismatch;
- Preview wired to Production;
- a configured Proof reference;
- partial Supabase configuration;
- legacy/non-publishable key format;
- a Supabase URL containing a path;
- non-HTTPS and non-origin hosted site URLs;
- wildcard hosted origins;
- loopback, IP-literal, and DNS-trailing-dot hosted origins;
- nonstandard hosted Supabase ports;
- canonical and prefixed privileged credential variable classes;
- privileged values hidden behind arbitrary variable names;
- secret-value redaction from validation errors.
- explicit local design-preview success and hosted/non-loopback/implicit-development denial.

The CI workflow contract additionally pins `OUR_DAYS_ENVIRONMENT=local` and `OUR_DAYS_RESOURCE_MODE=detached`. A metadata integration test proves that the shared validator and root metadata accept the same loopback origins and fail closed together. Every CI build also runs the independent source/build scan described in `PRIVATE_ARTIFACT_SCAN_REPORT.md`.

These checks establish configuration and artifact consistency only: the operator-provided Proof denylist may still be incomplete, and code cannot prove that a declared Production origin or project reference belongs to the intended external resource. External project inspection, environment scoping, RLS, invitations, membership revocation, and redirect allowlists remain Phase 2 and release gates.
