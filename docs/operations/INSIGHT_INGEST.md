# Insight ingest contract

Daily curated Insights (quotes and tidbits from podcasts or essays) are
circle-level cards. They are **not** personal journal entries and must not
show a family-member byline.

Ordinary members never see Insight in **+ New moment**. Humans post thoughts,
verses, photos, and the rest through the existing composer. Insights are
created only by an organizer or an automation that authenticates as one.

## Authorization

| Gate | Rule |
| --- | --- |
| Who | Active **organizer** of the target circle |
| Circle | Server-derived from the organizer session. A client `circleId` is accepted only when it matches that active circle. |
| Browser writes | Cookie session + same-origin `Origin` matching `NEXT_PUBLIC_SITE_URL` |
| Agent writes | Organizer access token (`Authorization: Bearer …`) **or** the same RPC against Supabase with that JWT |
| Database | `create_insight_moment` independently rechecks `auth.uid()` and `is_circle_organizer` |

Public signup stays disabled. This path does not provision accounts, use a
service-role key, or impersonate another adult's journal. `recorded_by_membership_id`
is stored for audit only and is not rendered as an author.

## Payload

```json
{
  "quote": "Morning sunlight is the most powerful stimulus for setting your circadian rhythm.",
  "attribution": "Huberman Lab — Master Your Sleep",
  "sourceUrl": "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
  "occurredOn": "2026-09-04",
  "circleId": "optional-must-match-active-circle"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `quote` | yes | 1–4000 characters after trim. Stored as `moments.body`. |
| `attribution` | yes | 1–160 characters after trim. Stored as `moments.title`. Example: `Huberman Lab — episode name`. |
| `sourceUrl` | no | `https://` only, 12–2000 characters. Timestamped YouTube `?t=` links are allowed. |
| `occurredOn` | no | `YYYY-MM-DD`. Defaults to today in the circle timezone. Cannot be in the future. |
| `occurredAt` / `occurredTimezone` | no | Both present or both omitted. Same pairing rule as written moments. |
| `circleId` | no | Must equal the organizer's active circle when supplied. |

## HTTP

`POST /api/insights`

Success: `201 { "ok": true, "momentId": "<uuid>" }`

Failures: `400` invalid payload, `401` unsigned, `403` not an organizer / wrong
circle / failed same-origin check.

## RPC (preferred for scheduled posts)

```
POST {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_insight_moment
Authorization: Bearer <organizer access token>
apikey: <publishable key>
Content-Type: application/json
```

```json
{
  "circle_id": "<circle uuid>",
  "quote": "…",
  "attribution": "Huberman Lab — episode name",
  "source_url": "https://www.youtube.com/watch?v=…&t=120",
  "occurred_on": "2026-09-04"
}
```

A later worker can keep using this RPC with a dedicated organizer membership.
Do not put a service-role key in the web deployment.

## Timeline behavior

- Family feed includes Insights. Personal journals do not.
- Cards reuse the Bible-verse treatment: quote, small attribution, optional
  Listen / Read the source link. No avatar or person name.
- Existing note and reaction chrome still works.
- Organizers can trash/restore Insights. There is no composer edit path.
