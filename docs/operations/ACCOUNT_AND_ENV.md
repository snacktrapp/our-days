# Our Days account and env map

One app, one set of accounts. Do not paste secrets, tokens, or `.env` files into chat. Set values in the dashboard named below.

Never use Proof / proof-hq, LiftSync, or Bee Line Tech credentials for this product.

## Accounts

| System   | Use this                                                                                                                                                                                                                                                                                          | Do not                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub   | `snacktrapp/our-days` (already connected to Cursor)                                                                                                                                                                                                                                               | A Proof org repo, a new GitHub project, or a personal repo under another login                  |
| Vercel   | Existing project **our-days** under Vercel user `snacktrapp`. Live Production URL: `https://our-days-neon.vercel.app`. Dashboard: `https://vercel.com/snacktrapps-projects/our-days`                                                                                                              | A new Vercel project, a Proof Vercel team, or a LiftSync/Bee Line project                       |
| Supabase | The Our Days project **already attached to that Vercel project**. Read the Production values `OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF` and `NEXT_PUBLIC_SUPABASE_URL` from the existing Vercel Production env (or the matching Our Days Supabase dashboard). This repo does not commit those refs. | The paused LiftSync project, any Proof project, or a freshly created “maybe this is it” project |

Local no-Docker development does not need GitHub, Vercel, or Supabase credentials. Copy `.env.example` to `.env.local` and run `npm run dev`.

## Where each value lives

| Variable                                                         | Local (`.env.local`)                       | Existing Vercel project (`our-days`)                                                                                                                       | Our Days Supabase dashboard                                        |
| ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `OUR_DAYS_ENVIRONMENT`                                           | `local`                                    | Production: `production`. Preview: `preview` (hosted Preview also derives this from `VERCEL_ENV` if Production’s value was copied)                         | —                                                                  |
| `OUR_DAYS_RESOURCE_MODE`                                         | `detached`                                 | `supabase` on **Production and Preview**. Hosted Vercel never uses detached / file-journal mode.                                                           | —                                                                  |
| `OUR_DAYS_LOCAL_JOURNAL_MODE`                                    | `enabled`                                  | leave unset / `disabled`. Local file mode is rejected on Vercel.                                                                                           | —                                                                  |
| `OUR_DAYS_ENABLE_DESIGN_PREVIEW`                                 | `false`                                    | `false`. Hosted Vercel ignores fixture design-preview even if this is still `true`.                                                                        | —                                                                  |
| `NEXT_PUBLIC_SITE_URL`                                           | `http://localhost:3000`                    | Production: `https://our-days-neon.vercel.app`. Preview: that deployment’s HTTPS origin (derived from `VERCEL_URL` when the Production origin was copied). | Auth Site URL is Production. Add Preview `*.vercel.app` redirects. |
| `OUR_DAYS_PRODUCTION_SITE_ORIGIN`                                | empty                                      | `https://our-days-neon.vercel.app`                                                                                                                         | —                                                                  |
| `OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF`                         | empty                                      | Same Our Days project on Production **and** Preview. Already on the Vercel Production env if hosted Auth is live. Do not invent a ref.                     | Same 20-character project ref                                      |
| `OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF`                       | empty                                      | Same as the Production / Preview ref                                                                                                                       | —                                                                  |
| `OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS`                       | empty                                      | Every known Proof project ref                                                                                                                              | —                                                                  |
| `NEXT_PUBLIC_SUPABASE_URL`                                       | empty                                      | Already on the Vercel Production env                                                                                                                       | Project URL                                                        |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                           | empty                                      | Already on the Vercel Production env (`sb_publishable_…`)                                                                                                  | Publishable key only                                               |
| `OUR_DAYS_INVITATION_DELIVERY_MODE`                              | `disabled`                                 | Keep current Production value                                                                                                                              | —                                                                  |
| `OUR_DAYS_MEDIA_DELIVERY_MODE`                                   | `disabled`                                 | Keep current Production value. Hosted Vercel defaults this on unless it is explicitly `disabled`.                                                          | —                                                                  |
| `OUR_DAYS_PHOTO_POSTING_MODE`                                    | `disabled`                                 | Keep current Production value. Hosted Vercel defaults this on unless it is explicitly `disabled`.                                                          | —                                                                  |
| `OUR_DAYS_GOOGLE_CLIENT_ID` / `OUR_DAYS_GOOGLE_CLIENT_SECRET`    | Set here for first-party local OAuth       | Set on the existing Vercel project when first-party callbacks should run on that host                                                                      | Also paste the same Google client into Auth → Providers → Google   |
| `OUR_DAYS_X_CLIENT_ID` / `OUR_DAYS_X_CLIENT_SECRET`              | Set here for first-party local OAuth       | Same as Google, on the existing Vercel project                                                                                                             | Also paste the same X client into Auth → Providers → Twitter       |
| `OUR_DAYS_OAUTH_STATE_SECRET`                                    | Optional local HMAC                        | Set on the existing Vercel project if first-party OAuth is enabled there                                                                                   | —                                                                  |
| `OUR_DAYS_PHOTO_WORKER_EMAIL` / `OUR_DAYS_PHOTO_WORKER_PASSWORD` | empty unless running photo workers locally | Only if Production already uses them                                                                                                                       | Allowlisted Auth identity with **no** family membership            |
| `NEXT_PUBLIC_MAPTILER_KEY`                                       | Optional MapTiler **public** web key. Leave empty for “Map unavailable”. | Optional on Production **and** Preview. Public key only — never an admin/secret MapTiler token.                                                             | —                                                                  |

Google and X app setup (redirect URIs, email permission, no public signup) is in `docs/operations/OAUTH_SIGN_IN.md`.

## Vercel Preview must share Production’s Our Days Supabase

The hosted Preview at the existing Vercel project **our-days** is the real journal, not the local file store and not the fixture design-preview family. Enable these **Production** variables for **Preview** as well (Vercel → snacktrapps-projects/our-days → Settings → Environment Variables → each name → Preview). Do not paste values into chat.

Required public / non-secret names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the browser publishable key or public anon JWT — never a service-role value)
- `OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF`
- `OUR_DAYS_PRODUCTION_SUPABASE_PROJECT_REF` (same ref)
- `OUR_DAYS_FORBIDDEN_SUPABASE_PROJECT_REFS`
- `OUR_DAYS_RESOURCE_MODE` = `supabase`
- `OUR_DAYS_PRODUCTION_SITE_ORIGIN` = `https://our-days-neon.vercel.app`

Optional:

- `NEXT_PUBLIC_MAPTILER_KEY` — MapTiler public web key for the shared Place picker (Location entry and Details on every other type). Leave unset until it exists in the Vercel dashboard; typed labels still save, the closed row still matches date/time chrome, and the map shows “Map unavailable.”

Also enable Preview for the current Production values of `OUR_DAYS_PHOTO_POSTING_MODE`, `OUR_DAYS_MEDIA_DELIVERY_MODE`, and `OUR_DAYS_PHOTO_WORKER_EMAIL` / `OUR_DAYS_PHOTO_WORKER_PASSWORD` when Production already uses the verified photo worker.

Leave Preview **unchecked** for service-role keys, `DATABASE_URL`, `SUPABASE_JWT_SECRET`, and any `sb_secret_` / `sbp_` value. Leave `NEXT_PUBLIC_SITE_URL` scoped to Production so Preview can use its own `*.vercel.app` origin.

`OUR_DAYS_LOCAL_JOURNAL_MODE` and `OUR_DAYS_ENABLE_DESIGN_PREVIEW` must stay off on Preview.

## Never put these in the web app or in chat

The Next.js process rejects them by name and by value pattern:

- Supabase service-role / secret keys (`sb_secret_…`, `service_role`)
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_JWT_SECRET`
- Direct Postgres URLs and database passwords
- Management tokens and PEM private keys

A future isolated worker may receive a narrow bypass. That is a separate deployment, not this Vercel project.

## If a Cloud Agent needs a secret

Name the variable and the dashboard:

- Hosted Our Days: **Vercel → snacktrapps-projects/our-days → Settings → Environment Variables** (Production and/or Preview).
- Cursor Cloud Agent secrets: only when this agent must call a live provider. Same variable name. Brian sets it in the Cursor dashboard, not in chat.
- Provider consoles: Google Cloud OAuth client and X developer portal for the Our Days app; then the same client ID/secret into the Our Days Supabase Auth providers if hosted Auth will use them.

Do not send the value back in a comment, issue, or chat message.
