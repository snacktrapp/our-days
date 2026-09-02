# Our Days release workflow

This runbook replaces direct deployment from a developer worktree. Localhost is
for rapid iteration; a password-free Vercel Preview from a short-lived branch is
the acceptance environment. Production receives only the exact commit approved
in that Preview after the pull-request gate passes.

## Environment boundary

| Environment | Git source          | Vercel                              | Supabase                              | Permitted data          |
| ----------- | ------------------- | ----------------------------------- | ------------------------------------- | ----------------------- |
| Local       | working branch      | local server                        | local stack                           | synthetic fixtures only |
| Preview     | short-lived branch  | password-free Preview deployment    | detached; design preview only         | synthetic fixtures only |
| Production  | approved `main` SHA | Git-connected Production deployment | dedicated Our Days Production project | private family data     |

Preview must never use the Production Supabase URL, publishable key, Auth users,
database rows, or Storage objects. Production must list every known Proof project
reference in `OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS`.
The web deployment never receives a service-role key, database password, direct
database URL, JWT secret, or Supabase management token.

## One-time setup

1. Create the isolated Our Days GitHub repository under the approved personal
   account and add it as `origin`. Never change global GitHub authentication to
   accomplish this.
2. Protect `main`. Require a pull request plus the Quality, Functional browsers,
   Local Supabase authorization, and Visual checks before merging.
3. Connect the GitHub repository to the existing Our Days Vercel project.
4. Configure Preview as detached design mode with synthetic fixtures and Vercel
   Deployment Protection. Generate a password-free share link for acceptance.
5. Keep Production Supabase credentials scoped to Production only. A connected
   staging database is unnecessary until a future release specifically needs a
   hosted backend rehearsal; creating one requires separate cost approval.

## Environment variables

Configure values in Vercel, never in committed environment files.

| Variable                                   | Preview                 | Production                 |
| ------------------------------------------ | ----------------------- | -------------------------- |
| `OUR_DAYS_ENVIRONMENT`                     | `preview`               | `production`               |
| `OUR_DAYS_RESOURCE_MODE`                   | `detached`              | `supabase`                 |
| `NEXT_PUBLIC_SITE_URL`                     | Preview HTTPS origin    | Production HTTPS origin    |
| `OUR_DAYS_PRODUCTION_SITE_ORIGIN`          | Production HTTPS origin | Production HTTPS origin    |
| `OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF`   | empty                   | Production ref             |
| `OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF` | Production ref          | Production ref             |
| `NEXT_PUBLIC_SUPABASE_URL`                 | empty                   | Production base URL        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`     | empty                   | Production publishable key |
| `OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS` | complete Proof denylist | complete Proof denylist    |
| `OUR_DAYS_ENABLE_DESIGN_PREVIEW`           | `true`                  | `false`                    |

Invitation, media delivery, photo posting, and worker credentials must be scoped
independently. Preview stays detached; Production is changed only as part of an
approved release.

## Change and acceptance loop

1. Start from current `main` and create a short-lived feature branch.
2. Make one coherent batch. Run `npm run verify:focused` plus task-specific
   Playwright tests while iterating; do not run the full release gate repeatedly.
3. Commit and push the branch. Vercel creates the Preview while a pull request to
   `main` starts the independent CI jobs in parallel.
4. Share the password-free Preview URL. Brian reviews that exact deployment while
   CI runs formatting, lint, types, all unit and browser tests, the production
   build, visual baselines, database authorization, recovery, and artifact scans.
5. Fixes stay on the same branch and repeat the focused local checks. Vercel and
   CI replace the Preview/check results for the new commit.
6. Record approval in the pull request against the exact Git SHA and Preview
   deployment. Do not merge if approval names an older commit.

## Production release

1. Merge the approved pull request only after every required check passes. Branch
   protection prevents direct pushes and unverified merges to `main`.
2. If migrations changed, apply only backward-compatible reviewed migrations
   before switching application traffic. Re-run authorization and status checks.
3. The Git-connected Vercel project builds the approved `main` SHA with Production
   environment values. Preview is deliberately detached, so promoting its build
   artifact would cross the environment boundary and is forbidden.
4. Confirm the Production deployment reports the approved SHA and Ready status.
5. Run sign-in, family timeline, private media delivery, and sign-out checks;
   monitor runtime errors for at least five minutes.

## Failure and rollback

- Application regression: immediately roll back the Vercel domain to the prior
  known-good Production deployment, then diagnose on a feature-branch Preview.
- Database migration regression: do not perform an improvised destructive
  rollback. Keep migrations backward-compatible and apply a reviewed forward fix.
- Media-processing failure: retain the user-visible placeholder and original
  private upload; never interpret absence from a pending list as publication.
- Authorization or privacy failure: disable the affected feature or roll back the
  application immediately, revoke exposed access, and treat the event as a
  release blocker.

Every release record should contain the Git SHA, Preview URL and deployment ID,
required-check results, approving person/time, Production deployment ID,
post-release smoke result, and rollback candidate.
