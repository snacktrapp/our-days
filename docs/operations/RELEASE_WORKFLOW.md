# Our Days release workflow

This runbook replaces direct deployment from a developer worktree. Localhost is
for rapid iteration; the installed staging PWA is the acceptance environment.
Production receives only a committed, verified release candidate.

## Environment boundary

| Environment | Git source     | Vercel                                      | Supabase                                                                                                                                       | Permitted data                                                                |
| ----------- | -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Local       | working branch | local server                                | local stack                                                                                                                                    | synthetic fixtures only                                                       |
| Staging     | `staging`      | protected staging/preview deployment        | existing Our Days Supabase already attached to Vercel project `our-days` (same project as Production until a dedicated staging project exists) | live family data on that attached project; Preview site origin stays distinct |
| Production  | `main`         | staged Production deployment, then promoted | dedicated Our Days Production project                                                                                                          | private family data                                                           |

Vercel Preview for this repository uses the Our Days Supabase already attached
to the `our-days` Vercel project — the same project Production uses. Do not
point Preview at LiftSync, Proof, or a newly created project. Preview still
must use its own `*.vercel.app` site origin, not `https://our-days-neon.vercel.app`.
A later dedicated staging project remains optional. Production and Preview must
both list every known Proof project reference in
`OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS`.
The web deployment never receives a service-role key, database password, direct
database URL, JWT secret, or Supabase management token.

## One-time setup

1. Create the isolated Our Days GitHub repository under the approved personal
   account and add it as `origin`. Never change global GitHub authentication to
   accomplish this.
2. Push `main`, create `staging` from the verified baseline, and protect both
   branches. Require the Quality, Functional browsers, Local Supabase
   authorization, and Visual checks before merging.
3. Connect the GitHub repository to the existing Our Days Vercel project.
4. Assign a stable protected staging hostname to the `staging` branch when one
   exists. Enable the Production Our Days public Supabase values on Preview
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, project
   refs, photo/media flags). Do not enable service-role or database URLs.
5. Do not create a second Supabase project for Preview. Auth redirects for
   Preview `*.vercel.app` origins belong on the existing Our Days project.
6. Configure staging Auth redirects for the stable staging origin. Keep design
   fixtures disabled in every hosted environment.

Supabase branches consume paid compute. Creation requires explicit cost approval;
pause or delete unused branches where the selected staging model permits it.

## Environment variables

Configure values in Vercel, never in committed environment files.

| Variable                                   | Staging                      | Production                 |
| ------------------------------------------ | ---------------------------- | -------------------------- |
| `OUR_DAYS_ENVIRONMENT`                     | `preview`                    | `production`               |
| `OUR_DAYS_RESOURCE_MODE`                   | `supabase`                   | `supabase`                 |
| `NEXT_PUBLIC_SITE_URL`                     | stable staging HTTPS origin  | Production HTTPS origin    |
| `OUR_DAYS_PRODUCTION_SITE_ORIGIN`          | Production HTTPS origin      | Production HTTPS origin    |
| `OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF`   | same Our Days Production ref | Production ref             |
| `OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF` | Production ref               | Production ref             |
| `NEXT_PUBLIC_SUPABASE_URL`                 | same Our Days Production URL | Production base URL        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`     | same Our Days Production key | Production publishable key |
| `OUR_DAYS_LOCAL_JOURNAL_MODE`              | unset / `disabled`           | unset / `disabled`         |
| `OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS` | complete Proof denylist      | complete Proof denylist    |
| `OUR_DAYS_ENABLE_DESIGN_PREVIEW`           | `false`                      | `false`                    |

Invitation, media delivery, photo posting, and worker credentials must be scoped
independently. A feature is enabled in staging only after its isolated backend is
ready; Production is changed only as part of an approved release.

## Change and acceptance loop

1. Start from current `staging` and create a short-lived feature branch.
2. Make one coherent batch. Run focused tests while iterating.
3. Run formatting, lint, type checks, unit tests, production build, functional
   mobile browsers, visual baselines, database authorization tests, and artifact
   scanning through CI.
4. Merge to `staging` only after all required checks pass. Vercel deploys the
   committed branch to the stable staging PWA.
5. Run staging smoke tests for sign-in, timeline loading, note creation,
   photo/video upload and background processing, reactions, notes, edit/trash,
   sign-out, and access revocation. Inspect browser console, failed requests, and
   Vercel runtime errors.
6. Brian reviews the installed staging PWA and annotates that deployment. Fixes
   repeat this loop; localhost is not an approval substitute.
7. Record approval against the exact Git commit and staging deployment ID.

## Production release

1. Merge the approved commit from `staging` to `main`; do not deploy a dirty
   worktree. `npm run release:state` must pass.
2. If migrations changed, apply only backward-compatible reviewed migrations
   before switching application traffic. Re-run authorization and status checks.
3. Create a staged Production Vercel deployment without assigning the Production
   domain. Confirm its commit, environment identity, project IDs, build result,
   artifact scan, and headers.
4. Run read-only Production-origin smoke checks and inspect runtime errors.
5. Promote that staged deployment to the Production domain. Do not rebuild from
   an uncommitted local directory.
6. Re-run sign-in, family timeline, private media delivery, and sign-out checks;
   monitor runtime errors for at least five minutes.

## Failure and rollback

- Application regression: immediately roll back the Vercel domain to the prior
  known-good Production deployment, then diagnose on staging.
- Database migration regression: do not perform an improvised destructive
  rollback. Keep migrations backward-compatible and apply a reviewed forward fix.
- Media-processing failure: retain the user-visible placeholder and original
  private upload; never interpret absence from a pending list as publication.
- Authorization or privacy failure: disable the affected feature or roll back the
  application immediately, revoke exposed access, and treat the event as a
  release blocker.

Every release record should contain the Git SHA, staging URL and deployment ID,
required-check results, approving person/time, Production deployment ID,
post-release smoke result, and rollback candidate.
