# Measurements and read-only checks (2026-09-23/24 UTC)

Supporting note for [`PERF-AUDIT.md`](./PERF-AUDIT.md). All numbers were taken in
this run. Local builds used `main` @ `0034902` with `.env.example` values (local
journal mode). No production data was read and nothing was mutated.

## External checks (read-only, no family data)

| Check | Method | Result |
| --- | --- | --- |
| Supabase project region | Supabase integration `get_project` (metadata only) | `us-west-1`, Postgres 17.6, `ACTIVE_HEALTHY` |
| Vercel Function region | `curl -D - https://our-days-neon.vercel.app/sign-in` (public page) ×3 | `x-vercel-id: pdx1::iad1::…` every time (edge `pdx1`, Function `iad1`) |
| JWT signing | `GET https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` (public) | 1 key, `ES256`/`EC`, so `getClaims()` verifies locally after a JWKS fetch cached for 10 min (`@supabase/auth-js` 2.112.4, `GoTrueClient.getClaims`) |
| Proxy on static assets | Fresh-connection `curl` timings from a VM ~1.5 ms from the `pdx1` edge | see below |

### Static asset TTFB (same edge, new TLS connection each time)

| Request | Proxy runs? | TTFB (5 samples) |
| --- | --- | --- |
| `/_next/static/chunks/webpack-….js` (CDN `HIT`) | yes (fresh CSP nonce on the response) | 116, 107, 92, 90, 102 ms |
| `/icon-192.png` | no (excluded by matcher) | 47, 51, 46, 46, 57 ms |
| `/sign-in` (dynamic page, `iad1` Function) | yes | 222, 185, 166 ms |

TLS completes at about 30 ms in every row, so the proxy adds roughly 45–65 ms of
server time per static asset. Chunk names (`webpack-….js`) show production builds
with webpack, so the bundle numbers below come from `next build --webpack`.

## `/family` client JavaScript (local production build, webpack)

Computed from `.next/server/app/(journal)/family/page_client-reference-manifest.js`
plus `rootMainFiles`, excluding `nomodule` polyfills (which iOS doesn't load). The
content tag comes from distinctive strings in each minified chunk.

| Chunk | Raw | Gzip | Brotli | Content |
| --- | ---: | ---: | ---: | --- |
| `3794-….js` | 240,796 | 65,414 | 53,382 | Next.js client runtime |
| `4bd1b696-….js` | 201,055 | 63,157 | 54,079 | react-dom |
| `864-….js` | 191,010 | 53,946 | 45,910 | **supabase-js** (GoTrue + Realtime) |
| `1815-….js` | 101,592 | 30,569 | 26,556 | **composer** (+ Bible fields) |
| `44530001-….js` | 64,204 | 13,937 | 12,171 | **supabase-js** (auth) |
| `970-….js` | 52,332 | 15,765 | 14,051 | **photo upload / status shelf** |
| `723-….js` | 43,624 | 14,448 | 12,920 | timeline cards / pager |
| 12 smaller chunks | 77,881 | 28,915 | 25,436 | route/app glue |
| **Total (19 files)** | **972,494** | **286,151** | **244,505** | |

The bold rows (supabase-js, composer, upload/status) total about 409 KB raw /
114 KB gzip / 99 KB brotli, about 40% of the route. A Turbopack build gives a
similar total (~977 KB raw excluding polyfills) with the same composition. CSS is
~197 KB raw / 34 KB gzip in one stylesheet (`globals.css`, 10,011 lines).

Lazy already (good): the 4.1 MB Bible catalog (`bible-verse-catalog.ts:112-118`),
`tus-js-client`, the Web Push actions, and MapLibre (isolated in the
`/internal/map-picker` iframe).

## Derived constants from code

| Item | Value | Source |
| --- | --- | --- |
| Feed page size | 20 (+1 look-ahead), max 25 cumulative pages | `src/data/moments.server.ts:80-81, 761` |
| Server read deadline | 8 s per request, retried once when transient (timeouts included) | `src/lib/supabase/server.ts:16-33`, `family-session-error.ts:58-89` |
| Resume refresh debounce | 1.2 s, no minimum hidden time | `timeline-resume-refresh.ts:1` |
| Activity poll | 30 s while visible, plus on mount and every visibility change | `activity-banner.tsx:12, 88-90` |
| Upload status poll | 10 s only while work is active, plus mount, resume, online | `photo-status-shelf.tsx:920-962` |
| Photo memory cache | 24 entries / 16 MB / 60 s | `private-media-memory.ts:2-4` |
| Photo lazy margin | 800 px (observes the album) | `private-photo-image.tsx:36-44` |
| Photo limits | 25 MB, JPEG/PNG/WebP, TUS 6 MB chunks, 6 per moment | `photo-upload.ts:22-23`, `multi_photo_moments.sql:626` |
| Display derivative | 2560 px max edge, WebP q82 effort 4 | `scripts/lib/photo-display-derivative.mjs:11, 515-528` |
| Processing route | `maxDuration` 300 s, synchronous | `src/app/api/photos/process/route.ts:13, 114` |
| Video limits | 100 MB, 60.5 s, TUS 2 MB chunks, retries `[0, 1, 3, 5, 10]` s | `video-upload.ts:14-15, 178-179, 304` |

## Reproduce

```bash
# region + proxy timings (public endpoints only)
curl -s -o /dev/null -D - https://our-days-neon.vercel.app/sign-in | grep -i x-vercel-id
curl -s -o /dev/null -w 'tls=%{time_appconnect} ttfb=%{time_starttransfer}\n' \
  https://our-days-neon.vercel.app/icon-192.png
# (chunk URL: first /_next/static/chunks/*.js in the /sign-in HTML)

# bundle composition
npm ci
env $(grep -v '^#' .env.example | grep -v '^$' | xargs) npx next build --webpack
# then sum the page_client-reference-manifest chunks + build-manifest rootMainFiles
```
