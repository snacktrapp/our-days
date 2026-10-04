# Our Days for iPhone

A first-slice Expo app in `mobile/`. It signs into the same Supabase project as the web journal, lists circles, reads the timeline, and posts a thought. The Next.js API on Vercel stays the media server. This folder does not change the web app.

## What works

- Email code sign-in, the same passwordless flow as `src/features/auth/sign-in-actions.ts`: `signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp` (`type: "email"`). The button says **Email me a code**. The session is stored in the iOS keychain through `expo-secure-store` (chunked, because a Supabase session is larger than one keychain value).
- Password sign-in from **Sign in with a password** on the same screen. It calls `signInWithPassword` and stores the session in that same chunked secure storage. Members usually have no password; the App Review account does.
- Circle switcher, including **All circles**. A circle calls `list_timeline_moments`. All circles calls `list_all_timeline_moments`, and falls back to the first circle if that RPC fails, matching the web.
- Timeline cards for thoughts, photos, videos, and insights. Photos use `GET /api/media/moments/:id?photo=:photoId&w=1080`. Video and insight posters use `GET /api/media/videos/:id/poster`. Those routes read the Supabase session from cookies, so the app sends the same `base64-` cookie `@supabase/ssr` writes in the browser.
- Posting a thought, photo, or video, plus comments, hearts, and edits.
- Settings: profile color, theme, notifications, invitations, **Privacy & support** (Privacy Policy, Terms of Use, Support, Contact us, Blocked people), and **Delete account**.
- Report and block from the ••• menu on a post or comment. If the safety RPC is not deployed yet, the button shows a plain error and does not crash.
- A one-time Terms agreement after sign-in. If `get_my_terms_acceptance` is not deployed yet, the gate lets the person through.

## What is stubbed

- Magic-link return into the app. The email link still opens the website. Type the code here.
- Android is configured so the project file and adaptive icon stay valid. This spike is the iPhone app.

## App icon and splash

`mobile/assets/icon.png` and the splash image are the Our Days mark, not the Expo template. The splash is that mark on `#101216`, with a light-mode background of `#edf0f4`.

**Icon/splash require a new EAS native build; do not ship via OTA.** `runtimeVersion.policy` is `appVersion` (currently `0.5.0`). An EAS Update cannot change the icon or the native splash.

## Run in Expo Go

Use Expo Go that matches **SDK 57**. From the repository root:

```bash
cd mobile
cp .env.example .env
```

Set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the publishable key already on the Vercel project **our-days** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Do not put a service-role or secret key in the app or in git.

```bash
npm install
npx expo start
```

Scan the QR code with the iPhone camera and open the project in Expo Go. Sign in with an email that already belongs to a circle, then enter the six-digit code from that message.

`EXPO_PUBLIC_SUPABASE_URL` defaults to `https://snwmwzbeajfrateksolo.supabase.co`. `EXPO_PUBLIC_SITE_URL` defaults to `https://our-days-neon.vercel.app`, which is where the media routes live.

## TestFlight with EAS

No Apple credentials are stored in this repo. These commands prepare a store build. They do not submit it.

```bash
cd mobile
npm install
npx eas-cli@latest login
npx eas-cli@latest init
```

`eas.json` has two store profiles. `preview` is the TestFlight profile. `production` is the App Store profile. Both auto-increment the build number. The iOS bundle id is `com.snacktrapp.ourdays`.

Put the publishable key in EAS, not in the repo:

```bash
npx eas-cli@latest env:create \
  --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --value "<publishable key>" \
  --environment preview \
  --visibility plaintext

npx eas-cli@latest env:create \
  --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --value "<publishable key>" \
  --environment production \
  --visibility plaintext
```

Build and, when an Apple account exists, submit the preview build to TestFlight:

```bash
npx eas-cli@latest build --platform ios --profile preview
npx eas-cli@latest submit --platform ios --profile preview
```

The production profile is the same shape:

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios --profile production
```

`submit` stops until someone connects an Apple Developer account in EAS. Do not invent credentials.

## Over-the-air updates (EAS Update)

`expo-updates` is installed and `app.json` points at the EAS Update URL with `runtimeVersion.policy = "appVersion"`. The `production` build profile uses the `production` channel. A build only receives updates if it was built with `expo-updates` and has the same app `version` (runtime `0.5.0`). Changing native code, the icon, the splash, or the app `version` needs a new store build. Do not ship the icon or splash with `eas update`.

Ship a JS-only change to production builds:

```bash
npx eas-cli@latest update --channel production --environment production --message "describe the change"
```

`--environment production` pulls `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from EAS. The Supabase URL and site URL fall back to the defaults in `src/lib/config.ts`.

## Before every build upload or OTA update

```bash
npm run typecheck
npm run lint
SUPABASE_ACCESS_TOKEN=... npm run e2e:signin   # live email-code sign-in, session persistence, restart, first API calls
```

`scripts/e2e-signin.mjs` runs the app's real auth modules under Node with
`expo-secure-store` replaced by a double that enforces the 2048-byte limit. It
signs in as the Operations test account (override with `E2E_TEST_EMAIL`) and
refuses personal accounts.
