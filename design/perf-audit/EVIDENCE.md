# Perf audit — evidence appendix

Supporting data for [PERF-AUDIT.md](./PERF-AUDIT.md). Collected 2026-09-23/24 UTC on `main` @ `0034902` (#129).

Everything below was **read-only**. No production row content was read (only
counts, byte sizes, pixel dimensions, and normalized query statistics), nothing
was written, and no setting was changed.

## 1. Where the code runs

### Vercel function region (production)

Anonymous GETs against the production origin (`our-days-neon.vercel.app`):

```text
== /
HTTP/2 307
location: /sign-in
x-vercel-id: pdx1::iad1::swmmm-1790208296437-3fb81b81dc52
== /sign-in
HTTP/2 200
x-vercel-id: pdx1::iad1::6ht9r-1790208298250-8d90f9933132
== /api/media/moments/00000000-0000-4000-8000-000000000000
HTTP/2 404
x-vercel-id: pdx1::iad1::2bcpn-1790208298455-0971ec8c4c1e
```

`x-vercel-id` is `<edge PoP>::<function region>::<id>`. `pdx1` is the edge
nearest the audit VM (not Brian's phone). The function region is **`iad1`
(Washington, D.C. / AWS us-east-1)**. The repo pins no region (no
`vercel.json`; `preferredRegion` is deprecated in Next 16 —
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/preferredRegion.md`).

### Supabase project

Supabase MCP `get_project` for `snwmwzbeajfrateksolo`:

| Field    | Value                           |
| -------- | ------------------------------- |
| region   | **`us-west-1`** (N. California) |
| Postgres | 17.6.1.166                      |
| status   | ACTIVE_HEALTHY                  |
| created  | 2026-08-31                      |

Vercel `sfo1` is the region co-located with AWS `us-west-1`. Typical
us-east-1 ↔ us-west-1 round trip is ~60–70 ms; confirm with the existing
Preview-only `[preview-supabase-timing]` logs (`src/lib/supabase/server.ts:13-59`,
field `headersMs`).

### Auth verification cost

`GET https://snwmwzbeajfrateksolo.supabase.co/auth/v1/.well-known/jwks.json`
returns one `ES256` key. With asymmetric keys, `supabase.auth.getClaims()`
verifies locally (WebCrypto) and caches the JWKS module-globally for 10 minutes
(`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:49-69, 5238-5269,
5335-5404`). Network is only needed for the JWKS fetch on a cold instance and for
refreshing an expired access token (`jwt_expiry = 3600` in
`supabase/config.toml:164`), which is the common case on a cold open after an
hour away.

## 2. Database statistics (`pg_stat_statements`)

Window: since `2026-08-31 23:27:38 UTC` (project creation, ~23 days).
**Includes Preview traffic**: Preview deployments must use the production
Supabase project (`config/our-days-environment.ts:688-697`), so automated
preview/browser tests are mixed in with family use.

### Hot read paths (top by total time; one row per statement shape)

| Target                                                |  Calls | Mean ms | Max ms | Total s |
| ----------------------------------------------------- | -----: | ------: | -----: | ------: |
| `list_my_photo_intakes` (upload status shelf)         | 52,199 |    36.5 |  2,734 |   1,903 |
| `list_all_timeline_moments` (All circles feed)        |  1,178 |   125.9 |  2,015 |     148 |
| `get_photo_moment_delivery` (per photo request)       |  6,615 |    19.2 |  3,532 |     127 |
| `list_timeline_moments` (circle / person feed)        |    541 |    86.2 |  1,333 |      47 |
| `moment_photos` select (feed enrichment)              |  2,145 |    21.5 |    277 |      46 |
| `list_timeline_moments` (other arg shape)             |    371 |    94.9 |    395 |      35 |
| `get_moment_conversation`                             |  5,681 |     5.9 |    187 |      33 |
| `moment_reactions` select                             |  2,390 |    11.5 |    384 |      28 |
| `list_timeline_moments` (other arg shape)             |    275 |    95.5 |    514 |      26 |
| `get_video_moment_poster_delivery`                    |    566 |    24.4 |    499 |      14 |
| `get_video_moment_delivery` (per video range request) |    793 |    14.1 |    539 |      11 |
| `circle_memberships` select (identity)                | 10,751 |     0.6 |    131 |       7 |

`list_my_photo_intakes` alone used ~13× the total database time of the All
circles feed RPC.

### Write paths (aggregated across statement shapes)

| Function                     | Calls | Mean ms | Max ms |
| ---------------------------- | ----: | ------: | -----: |
| `reserve_photo_moment`       |    75 |   281.2 |  1,451 |
| `update_family_moment`       |    69 |   272.5 |    819 |
| `reserve_video_moment`       |    43 |   201.9 |    972 |
| `create_family_moment`       |    56 |   138.3 |  1,173 |
| `finalize_video_moment`      |    16 |    70.7 |    238 |
| `attach_photo_to_moment`     |    35 |    52.4 |    303 |
| `share_private_moment`       |    13 |    50.2 |    638 |
| `set_moment_audience`        |    32 |    46.5 |  1,010 |
| `create_moment_note`         |    46 |    42.4 |    132 |
| `list_web_push_deliveries`   |   132 |    27.6 |  1,454 |
| `set_written_moment_trashed` |    45 |    26.4 |    160 |
| `create_insight_moment`      |    28 |    23.2 |    184 |
| `reorder_moment_photos`      |    13 |    15.5 |     28 |
| `attach_video_moment_poster` |    20 |    13.2 |     36 |

The four slowest all contain a `pg_catalog.pg_timezone_names` lookup (§3).

## 3. The timezone lookup

`reserve_photo_moment` validates the posted timezone like this
(`supabase/migrations/20260908021903_keep_just_me_moment_tags.sql:364-367`);
the same pattern appears in the latest create/update family moment, video
reservation and insight definitions (`rg pg_timezone_names supabase/migrations`):

```sql
or (requested_occurred_timezone is not null and not exists (
  select 1 from pg_catalog.pg_timezone_names as zone
   where zone.name = requested_occurred_timezone
))
```

Measured on production (system catalog only):

```text
explain (analyze) select 1 from pg_catalog.pg_timezone_names as zone
 where zone.name = 'America/Los_Angeles';

Function Scan on pg_timezone_names (actual time=654.998..655.015 rows=1 loops=1)
  Filter: (name = 'America/Los_Angeles'::text)
  Rows Removed by Filter: 1195
Execution Time: 655.259 ms
```

`pg_timezone_names` enumerates and parses the on-disk tz database on every call
(1,196 zones here). iPhone posts always send a timezone, so every photo/video
reservation and every family moment create/edit pays it.

## 4. Data scale and media sizes (aggregates only)

| Item                                                                                                                                   |                                        Count |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------: |
| Moments (total / live)                                                                                                                 |                                      81 / 42 |
| Moment photos                                                                                                                          |                                           63 |
| Moment videos                                                                                                                          |                                           13 |
| Video poster rows                                                                                                                      |                                            5 |
| Circles                                                                                                                                |                                            3 |
| Active memberships                                                                                                                     |                                           12 |
| Photo intakes                                                                                                                          | 83 (verified 63, rejected 11, invalidated 9) |
| Photo cleanup jobs                                                                                                                     |                   **78 queued, 0 completed** |
| Intakes that `list_my_photo_intakes` keeps returning (claimed, cleanup not completed; each viewer sees their own in the active circle) |                                           78 |

| Media                                                  |   n |         Avg |       Max | Avg width | Max edge |
| ------------------------------------------------------ | --: | ----------: | --------: | --------: | -------: |
| Display derivative (WebP q82, what the feed downloads) |  63 |  **746 KB** |  2,299 KB |  1,993 px | 2,560 px |
| Original photo                                         |  63 |    4,386 KB | 10,192 KB |  3,484 px | 5,712 px |
| Video                                                  |  13 | **15.6 MB** |   36.1 MB |         — |        — |
| Video poster                                           |   5 |       53 KB |    118 KB |  1,424 px | 1,920 px |

Display derivatives are capped at 2,560 px (`scripts/lib/photo-display-derivative.mjs:11, 515-527`).
A feed card is ~390–430 CSS px wide (~1,170–1,290 device px at 3×).

The feed RPC averages 126 ms with only 81 moments in the whole database, i.e.
roughly 1.5 ms of per-row cost. The `moments` select policy calls
`private.can_read_live_moment(id)` per row (correlated, so it is not cached as an
init plan) — `supabase/migrations/20260907204138_moment_circles.sql:255-260` —
and `moment_photos` nests the same check (`:264-277`). The list RPCs are
`security invoker`, and their sort is not index-backed
(`supabase/migrations/20260912160000_list_all_timeline_moments.sql:133-177`), so
cost grows with total history, not page size.

## 5. Supabase performance advisors

`get_advisors(type: performance)` — INFO level only, no WARN:

- 37 × `unindexed_foreign_keys`, mostly private invitation/photo pipeline
  tables. Feed-relevant: `public.moment_photos` (`moment_photos_moment_fkey`,
  `moment_photos_original_fkey`, `moment_photos_derivative_fkey`),
  `public.moment_notes` and `public.moment_reactions` author FKs.
- 36 × `unused_index` (mostly invitation/export/audit tables).
- No `auth_rls_initplan` or `multiple_permissive_policies` findings.

Conclusion: indexes are not today's bottleneck; round trips (count × distance)
and per-row RLS function cost are.

## 6. Client bundle (local production build)

`npx next build --webpack` on the audit VM (detached mode; same client code).
Next 16 no longer prints first-load sizes, so chunks were read from
`.next/server/app/(journal)/family/page_client-reference-manifest.js` and the
build manifest, excluding `nomodule` polyfills. Gzip level 9 (Vercel serves
Brotli, typically ~15–20% smaller).

| Chunk                              | Gzip KB |  Raw KB | Contents (fingerprinted by strings)                                 |
| ---------------------------------- | ------: | ------: | ------------------------------------------------------------------- |
| `3794-…`                           |      64 |     235 | Next/React runtime                                                  |
| `4bd1b696-…`                       |      62 |     196 | React DOM                                                           |
| `864-…`                            |      53 |     187 | `@supabase/supabase-js` (GoTrue, Realtime, Storage, PostgREST)      |
| `1815-…`                           |      30 |      99 | Moment composer, location/date/Bible fields, drafts, journal chrome |
| `970-…`                            |      15 |      51 | Photo upload / TUS glue + Supabase storage                          |
| `44530001-…`                       |      14 |      63 | More Supabase auth                                                  |
| `723-…`                            |      14 |      43 | Timeline card client components                                     |
| layouts, page, error, small shared |     ~20 |     ~70 |                                                                     |
| **Total `/family` first-load JS**  | **277** | **944** |                                                                     |
| CSS (4 files)                      |      44 |     270 | `globals.css` is ~8,000+ lines                                      |

Already lazy (good): the 4 MB Bible catalog (`src/features/composer/bible-verse-catalog.ts:112-118`),
`tus-js-client`, MapLibre (internal map picker only), web-push actions.

## 7. Round-trip accounting (cold open, All circles)

Serial Supabase calls on the server before the first card's HTML is streamed,
from code (`§2.1` of the audit has file pointers):

| #     | Step                                                                            |                Serial calls |
| ----- | ------------------------------------------------------------------------------- | --------------------------: |
| 1     | `proxy.ts` token refresh when the access token expired (common after >1 h away) |                         0–1 |
| 2     | `/` page identity memberships, then 307 to `/family`                            | 1 (+ a phone↔function trip) |
| 3     | `/family` identity memberships (new request)                                    |                           1 |
| 4     | Journal context batch (circles, people, memberships, guardians)                 |                           1 |
| 5     | Circle names                                                                    |                           1 |
| 6     | `list_all_timeline_moments` (126 ms mean)                                       |                           1 |
| 7     | Enrichment wave: notes, reactions, photos, videos                               |                           1 |
| 8     | Conversation authors (memberships) + video posters                              |                           1 |
| 9     | Conversation authors (people)                                                   |                           1 |
| 10    | `visible_moment_authors` (only if an author is outside the roster)              |                         0–1 |
|       | **Before first card**                                                           |                   **~8–10** |
| 11    | `list_all_timeline_moments` again for the remainder                             |                           1 |
| 12–14 | Enrichment waves for the other 19 cards                                         |                           3 |

At ~62 ms per cross-country call that is ~0.5–0.6 s of pure network wait before
the first card, plus ~170 ms of database execution (list 126 ms, photos 21 ms,
conversations ~10 ms, context ~10 ms), plus any function cold start.

Per photo shown: `get_photo_moment_delivery` → `createSignedUrl` → download
(746 KB average, fully buffered) → SHA-256 → response
(`src/app/api/media/moments/[momentId]/route.ts:82-116`,
`src/lib/private-media-delivery.ts:86-115`).

Per photo processed (`src/app/api/photos/process/route.ts`,
`src/lib/photo-worker.server.ts`): `getUser`, status, worker
`signInWithPassword`, claim validation, download intake, upload canonical,
download canonical, storage info, complete validation, claim derivative,
download canonical again, upload display, download display, storage info,
complete derivative, sign out, status ≈ **17 serial calls**, 3 downloads of the
original, 3 full decodes.

## 8. Queries used (verbatim, read-only)

```sql
-- hot reads (abbreviated regex list)
select calls, round(mean_exec_time::numeric, 2) as mean_ms,
       round(max_exec_time::numeric, 1) as max_ms,
       round(total_exec_time::numeric, 0) as total_ms,
       (regexp_match(query, '(list_all_timeline_moments|list_timeline_moments|...)'))[1] as target
  from pg_stat_statements
 where query ~ '(list_all_timeline_moments|...)'
    or (query ilike '%pgrst_source%' and query ~ '"(circle_memberships|moment_notes|...)"')
 order by total_exec_time desc limit 40;

-- write functions
select (regexp_match(query, '(create_family_moment|...)'))[1] as fn, sum(calls),
       round((sum(total_exec_time)/nullif(sum(calls),0))::numeric, 1) as mean_ms,
       round(max(max_exec_time)::numeric, 0) as max_ms
  from pg_stat_statements where query ~ '(create_family_moment|...)'
 group by 1 order by mean_ms desc nulls last;

-- timezone lookup cost
explain (analyze, timing on, summary on)
select 1 from pg_catalog.pg_timezone_names as zone where zone.name = 'America/Los_Angeles';

-- counts
select (select stats_reset from pg_stat_statements_info),
       (select count(*) from private.photo_intakes),
       (select count(*) from private.photo_intakes i
         where i.upload_claimed_at is not null
           and not exists (select 1 from private.photo_object_cleanup_jobs c
                            where c.circle_id = i.circle_id and c.intake_id = i.id
                              and c.state = 'completed')),
       (select json_object_agg(state, n) from (select state, count(*) n
          from private.photo_object_cleanup_jobs group by state) s),
       (select json_object_agg(state, n) from (select state, count(*) n
          from private.photo_intakes group by state) s),
       (select count(*) from public.moments),
       (select count(*) from public.moments where trashed_at is null),
       (select count(*) from public.moment_photos),
       (select count(*) from public.moment_videos),
       (select count(*) from public.circles),
       (select count(*) from public.circle_memberships where status = 'active');

-- media sizes
select 'display_derivative', count(*), avg(output_size_bytes), max(output_size_bytes),
       avg(output_width), max(output_width), max(output_height)
  from private.photo_display_derivatives
union all select 'original', count(*), avg(verified_size_bytes), max(verified_size_bytes),
       avg(verified_width), max(verified_width), max(verified_height)
  from private.photo_originals
union all select 'video', count(*), avg(size_bytes), max(size_bytes), null, null, null
  from public.moment_videos
union all select 'video_poster', count(*), avg(size_bytes), max(size_bytes),
       avg(width_px), max(width_px), max(height_px)
  from public.moment_video_posters;
```
