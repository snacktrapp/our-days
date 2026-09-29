# Our Days for iPhone

A first-slice Expo app in `mobile/`. It signs into the same Supabase project as the web journal, lists circles, reads the timeline, and posts a thought. The Next.js API on Vercel stays the media server. This folder does not change the web app.

## What works

- Email code sign-in, the same passwordless flow as `src/features/auth/sign-in-actions.ts`: `signInWithOtp` with `shouldCreateUser: false`, then `verifyOtp` (`type: "email"`). The session is stored in the iOS keychain through `expo-secure-store` (chunked, because a Supabase session is larger than one keychain value).
- Circle switcher, including **All circles**. A circle calls `list_timeline_moments`. All circles calls `list_all_timeline_moments`, and falls back to the first circle if that RPC fails, matching the web.
- Timeline cards for thoughts, photos, videos, and insights. Photos use `GET /api/media/moments/:id?photo=:photoId&w=1080`. Video and insight posters use `GET /api/media/videos/:id/poster`. Those routes read the Supabase session from cookies, so the app sends the same `base64-` cookie `@supabase/ssr` writes in the browser.
- Posting a thought calls `create_written_moment` with the signed-in person’s id in the chosen circle, `audience: "family"`, and today’s date in that circle’s time zone.

## What is stubbed

- Password sign-in. Members do not have passwords. The web sends a six-digit code.
- Magic-link return into the app. The email link still opens the website. Type the code here.
- Accepting a pending invitation during sign-in.
- Photo and video capture, playback beyond the poster, comments, reactions, edits, and Just me posting.
- Android is configured only so Expo’s project file stays valid. This spike is the iPhone app.

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

`eas.json` has two store profiles. `preview` is the TestFlight profile. `production` is the App Store profile and auto-increments the build number. The iOS bundle id is `com.snacktrapp.ourdays`.

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
