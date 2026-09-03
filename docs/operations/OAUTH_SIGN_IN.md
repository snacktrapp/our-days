# Google and X sign-in

OAuth is **identity only**. Our Days stays invitation-only: a Google or X account may sign in only when that account’s email already belongs to an invited family membership. Completing Google or X login does not create a family, a membership, or a public signup.

The existing email magic-link path remains as a backup (“Email me a sign-in link”).

This repository does not invent or ship provider credentials. The UI, start routes, and callbacks are in place so the flow works as soon as Brian creates the apps and sets the variables in the dashboards named in `docs/operations/ACCOUNT_AND_ENV.md` — never in chat.

## Environment variables

Set these on the web app (`.env.local` for the file-backed local journal, and the **existing** Vercel project `our-days` / `https://our-days-neon.vercel.app` for a hosted first-party callback). Do not create a new Vercel project.

| Variable                        | Purpose                                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OUR_DAYS_GOOGLE_CLIENT_ID`     | Google OAuth 2.0 Web client ID                                                                                                                                                             |
| `OUR_DAYS_GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Web client secret                                                                                                                                                         |
| `OUR_DAYS_X_CLIENT_ID`          | X (Twitter) OAuth 2.0 client ID                                                                                                                                                            |
| `OUR_DAYS_X_CLIENT_SECRET`      | X (Twitter) OAuth 2.0 client secret                                                                                                                                                        |
| `OUR_DAYS_OAUTH_STATE_SECRET`   | Optional HMAC secret for the short-lived PKCE state cookie. Falls back to `OUR_DAYS_LOCAL_JOURNAL_SECRET`, then a local-only default. Set an explicit value anywhere the app is reachable. |
| `NEXT_PUBLIC_SITE_URL`          | Exact public origin. Redirect URIs are derived from this origin.                                                                                                                           |

Pairs must be complete: a client ID without its secret (or the reverse) fails startup validation. Leaving all four provider values empty is valid; the buttons still render and return “That sign-in method is unavailable right now.”

Do not put these secrets in `NEXT_PUBLIC_*` variables.

## Redirect URIs

First-party callback used by the local journal (and any host that uses the Next.js routes):

```
{NEXT_PUBLIC_SITE_URL}/api/auth/oauth/callback
```

Examples:

- `http://localhost:3000/api/auth/oauth/callback`
- `https://our-days-neon.vercel.app/api/auth/oauth/callback`

Hosted Supabase Auth (production resource mode) uses Supabase’s callback instead:

```
https://<OUR_DAYS_EXPECTED_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
```

Register **both** URIs on each OAuth app if the same Google/X app will serve local first-party sign-in and hosted Supabase sign-in.

## Google Cloud

1. In [Google Cloud Console](https://console.cloud.google.com/) create or open a project that is **not** a Proof project.
2. APIs & Services → OAuth consent screen. External is fine for a family app. App name: **Our Days**. Add the authorized domain for the production site.
3. Scopes: `openid`, `email`, `profile` (the app requests only these).
4. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
5. Authorized JavaScript origins: the site origin (`http://localhost:3000` and the production HTTPS origin).
6. Authorized redirect URIs: the first-party callback above, plus the Supabase `/auth/v1/callback` if hosted Auth will use this client.
7. Copy the client ID and secret into `OUR_DAYS_GOOGLE_CLIENT_ID` and `OUR_DAYS_GOOGLE_CLIENT_SECRET`.

## X (Twitter) developer portal

1. In the [X developer portal](https://developer.x.com/en/portal/dashboard) create a Project and App that is **not** a Proof app. User authentication must be OAuth 2.0.
2. App type: **Web App** (confidential client). Native/public PKCE-only clients are not enough; this app sends the client secret server-side.
3. Callback URI / Redirect URL: the same first-party callback, plus the Supabase `/auth/v1/callback` when hosted Auth will use this app.
4. Website URL: `NEXT_PUBLIC_SITE_URL`.
5. Enable **Request email from users**. Without that permission X will not return an address, and Our Days cannot match a family invitation.
6. App permissions should allow `users.read`. The authorize URL also requests `tweet.read` and `offline.access` because X’s OAuth 2.0 user-lookup flow requires them even though Our Days does not post or keep a refresh session.
7. Copy the OAuth 2.0 Client ID and Client Secret into `OUR_DAYS_X_CLIENT_ID` and `OUR_DAYS_X_CLIENT_SECRET`.

If X signs in but does not share email, the sign-in page shows that the account cannot be matched to a family invitation. The journal stays closed.

## Hosted Supabase (production resource mode)

When `OUR_DAYS_RESOURCE_MODE=supabase`, the Google and X buttons start `signInWithOAuth` and return through the existing `/auth/callback` membership check.

1. Supabase Dashboard → Authentication → Providers.
2. Enable **Google** and **Twitter**. Paste the same client ID and secret created above.
3. Confirm Authentication → Providers / Settings still has **public signup disabled**.
4. Authentication → URL configuration:
   - Site URL: Production origin `https://our-days-neon.vercel.app`
   - Redirect allow list: Production `{origin}/auth/callback` **and** the Vercel Preview wildcard (`https://*-snacktrapps-projects.vercel.app/auth/callback` or the project’s Preview URL) so hosted Preview Google/X/email links return to that deployment
5. The Next.js Google/X env vars are unused in this mode; Supabase holds the provider secrets. Keep public signup disabled so an uninvited Google/X identity cannot mint an Auth user.

`/auth/callback` already refuses a session with no `circle_memberships` row (`/access-unavailable`). OAuth does not bypass that check.

## Local journal (no Docker)

When `OUR_DAYS_LOCAL_JOURNAL_MODE=enabled`, the same buttons run the first-party authorize/callback routes. After Google or X returns a verified email, Our Days opens a session only if `findLocalAccount(email)` matches. The synthetic local members are `family@example.com` and `jordan@example.com`. A personal Google or X login whose email is not in that list is turned away.

Until the four provider variables are set, use the email backup with `family@example.com`.

## What this does not do

- It does not redesign Family, Memories, media, or the timeline.
- It does not treat Google or X as an open registration form.
- It does not add real household names to local sample data.
- It does not store refresh tokens or post to X.
