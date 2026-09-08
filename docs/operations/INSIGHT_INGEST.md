# Insight ingest contract

Daily curated Insights (quotes and tidbits from podcasts or essays) are stored
as **source items** and delivered only to members who turned that source on in
**Account → Timeline add-ons**. They land on the subscriber’s **Just me**
journal. They are not group cards and must not appear on the family feed as
anonymous Operations posts.

Ordinary members never see Insight in **+ New moment**. Sharing an Insight from
Just me creates a normal user-authored thought (with that member’s byline) on
the chosen circles.

## Authorization

| Gate           | Rule                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Who            | Active **organizer** of the target circle, including an Operations organizer                                        |
| Circle         | Server-derived from that session. A client `circleId` is accepted only when it matches the active circle.           |
| Browser writes | Cookie session + same-origin `Origin` matching `NEXT_PUBLIC_SITE_URL`                                               |
| Agent writes   | Organizer or Operations access token (`Authorization: Bearer …`) **or** the same RPC against Supabase with that JWT |
| Database       | `create_insight_moment` independently rechecks `auth.uid()` and `is_circle_organizer`                               |

Public signup stays disabled. This path does not provision accounts, use a
service-role key, or impersonate another adult's journal.

Do **not** resume a paused Huberman cloud routine from this contract. Cadence
stays operator-driven ingest plus per-user catalog delivery.

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

| Field                             | Required | Notes                                                                                                               |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `quote`                           | yes      | 1–4000 characters after trim. Stored on the source item and copied to Just me `moments.body`.                       |
| `attribution`                     | yes      | 1–160 characters after trim. Stored as source attribution / `moments.title`.                                        |
| `sourceUrl`                       | no       | `https://` only, 12–2000 characters. Timestamped YouTube `?t=` links are allowed.                                   |
| `occurredOn`                      | no       | `YYYY-MM-DD`. Defaults to today in the circle timezone. Cannot be in the future. Used as the source published date. |
| `occurredAt` / `occurredTimezone` | no       | Both present or both omitted. Same pairing rule as written moments.                                                 |
| `circleId`                        | no       | Must equal the organizer's active circle when supplied.                                                             |

## HTTP

`POST /api/insights`

Success: `201 { "ok": true, "momentId": "<source-item-uuid>" }`

The returned id is the **source item** id. Just me copies are created for
members who already have `insights.huberman_faith` enabled. Members who enable
the source later receive pending items at toggle time.

Failures: `400` invalid payload, `401` unsigned, `403` not an organizer /
wrong circle / failed same-origin check.

## RPC (preferred for scheduled posts)

```
POST {NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_insight_moment
Authorization: Bearer <organizer or Operations access token>
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

A later worker should authenticate as the circle’s Operations membership
(`tars-trapp@agentmail.to`). That membership stays a full organizer; the
Operations label only hides it from Family and People. Do not put a
service-role key in the web deployment. Do not use this path to post
no-byline family Insights.

## Timeline behavior

- New Insights appear only on subscribed Just me journals.
- Cards keep the Insight treatment: quote, small attribution, optional
  Listen / Read the source link. No avatar or person name.
- **Share to…** uses the existing Post to chips and creates a user-authored
  thought with that member’s byline.
- Existing note and reaction chrome still works.
- The journal owner can trash their delivered Just me Insight. There is no
  composer edit path for Insights.
