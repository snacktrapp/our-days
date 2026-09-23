# Our Days — Journal design review

**Date:** 2026-09-23
**Reviewed against:** `main` @ `0034902` (post-#129, "Restore OD byline badge and regenerate stale Insight posters")
**Mode:** design review only. No app code, no PR, no CI. Frames in `frames/` were produced by injecting throwaway CSS/JS into the design-preview build (`OUR_DAYS_ENABLE_DESIGN_PREVIEW=true`, 390×844, dark + light); nothing in `src/` was touched.
**Scope:** Journal timeline/feed and its chrome. Settings and Circles (#124) are out of scope. Locked product rules from the brief are treated as fixed.

---

## Executive take

The Journal is in good shape: the rail-node-card grammar is legible, the type system (serif for words, mono for chronology, interface sans for controls) is disciplined, and the quiet-versus-loud balance is right — the only saturated things on screen are photographs and the clay heart. The one real information-flow flaw is repetition: every text card announces its author twice and its day two or three times within a hand's width, which is chrome doing the same job as other chrome. Fix that (P0 #1), bring the switcher menu and note sheet into the same voice as the rest of the surface (P0 #2–4), and then leave the Journal alone; the feature ideas below are worth a later brief, not this one.

---

## 1. What's already strong — keep list

| What | Why it works | Where |
|---|---|---|
| **Center rail as the organizing idea** | Date pill → author node → card reads as a continuous line of life, exactly as the product brief describes. The 1px rail with faded ends is the right weight. | `.time-rail`, `.date-marker`, `.connection` |
| **Full-bleed cards in the feed** | Posts reach the feed edges with no border/radius; chronology (markers, nodes) keeps its inset. Media breathes; chrome stays small. | `.timeline .moment-card` (globals.css ~L6113) |
| **Three-voice type system** | Georgia for what people wrote; mono for dates/markers/kickers/cites; system sans for names and controls. Readers learn "mono = the record" once and it holds everywhere in the feed. | globals.css ~L5894–5941, L6153–6243 |
| **Quiet reactions** | Names as words ("Molly"), no counts, heart in clay. Notes as a plain list with an 8px author dot. This is the calmest social layer I've seen in a family app. | `MomentConversationControl` |
| **Insight card anatomy** | Clay `INSIGHT` label, serif quote, mono cite with source link, OD badge + "Our Days" byline on the rail. The card carries no author line of its own — which is what the text cards should learn from (P0 #1). | `moment-card.tsx` L294–347 |
| **Audience chip placement** | Left of the rail, 7px, hairline pill, decoration-only. It's readable when you look for it and invisible when you don't. Correct. | `.connection > .card-audience` |
| **Floating topbar + bottom nav pair** | Same 56px / 18px radius / blur geometry; scroll-away header; nav hides during note composition. The chrome feels like one object. | `.topbar`, `.bottom-nav` |
| **Quiet card banner (Direction A)** | Cream, hairline, 18px radius, 32px badge, pill CTA + "Not now", fade→collapse dismissal. Locked, and rightly so. | `journal-banner.tsx` |
| **Empty and end states** | "A story ready to begin" and "Earliest entry" reuse the date-marker pill grammar; the rail fades out beneath. No illustration, no CTA pill. Restrained and correct. | `timeline-feed.tsx`, `buildTimelineEntries` |
| **Return-to-Journal plumbing** | Media stays inline (no lightbox), native video fullscreen, `TimelineScrollMemory` per route, pull-to-refresh, save acknowledgment. Living in the Journal doesn't lose your place. | `timeline-scroll-memory.tsx`, `timeline-refresh-control.tsx` |

---

## 2. Information-flow diagnosis

### 2.1 The scan path for one entry (as built)

```
DAY MARKER        AUG 14, 2026                      ← day (1)
RAIL              [All our days] (M) Molly          ← audience · who (1)
                                Aug. 14, 2026 · 9:42 pm   ← day (2) · time
CARD TOP          (M) Molly · 📍 The kitchen        ← who (2) · where
BODY              "Tonight the kitchen was loud…"
ACTIONS           [note] [♡] Molly                  ← reactions as names
NOTES             ● Brian  Aug 15 · 7:20 AM         ← replies, newest first
                  I wrote this down because…
```

Everything here is individually well made. The problem is structural: **identity is announced twice (~40px apart) and the day is announced twice (~60px apart) on every text card.** On a milestone the year appears three times (marker, rail meta, seal). The reader isn't confused — the redundancy is harmless to comprehension — but it costs vertical rhythm and it dilutes the rail. If the rail node says who and when, the card shouldn't repeat it; if the card repeats it, the rail becomes ornament, which the product brief explicitly says it must not be.

The in-card author line is defensible on **photo and video cards**: media can run to `min(90dvh, 430px × 16/9)`, so by the time the reader reaches the caption the rail node is off-screen. It is not defensible on **thought, place, and milestone cards**, where the node is one line above.

### 2.2 Hierarchy inside the card

Correct as built. Words are the largest element (18px serif on thoughts, 14px on captions), the kind label and cite are the smallest (8–9px mono), names and controls sit between in 11px sans. Nothing competes with the photograph on a photo card. The `with Molly + 3` participants string is right-aligned, muted, and reads as context, not as a claim.

### 2.3 Chrome competing with content

- **Topbar.** Wordmark (104×20) over `ALL CIRCLES ˅` (10px mono caps). The brand is louder than the wayfinding state. For an app a family opens daily this is fine — the wordmark becomes wallpaper within a week and the state line is what the eye lands on. Leave it.
- **Switcher menu.** The one place the chrome breaks voice. The popover sets `Just me` / `All circles` in the record (mono) face, which everywhere else means "a date or a citation," and its surface is translucent so the `TODAY` pill bleeds through the menu. The brief also locks a subtitle — *All circles: Everything you can see* — that the current build does not render anywhere (the eyebrow was removed; `journalHeadings.all.eyebrow` is `"Circles"` and unused in the topbar). If the subtitle is intended, the menu is where it belongs; the 56px topbar has no room for it. → P0 #2.
- **Quiet card banner.** Sits above the feed as a sibling, not as a timeline entry; shows once until dismissed. It does not compete. The only note: it renders on every timeline route variant (`/family` soft-fail, preview, connected), so the pattern is uniform. Good.
- **Bottom nav.** Three items, hides during note composition and composer. No competition.
- **Dev indicator.** The Next.js `N` badge in preview overlaps the nav; production-irrelevant, ignore.

### 2.4 Quiet vs loud inventory

Loud (saturated or large): photographs, video posters, the clay heart, the blue active nav item and `Circles` back link, the red activity dot. That's it, and it's the right set. One leak: a `made-me-smile` reaction renders as the **😂 emoji**, and `remember-this` as ✨ — the only emoji on the surface, in a palette that otherwise uses line glyphs (♡ ◡ ✦ are the vocabulary's own symbols). → P0 #4.

### 2.5 Switcher hierarchy

`Just me | All circles` is the right pair. `Just me` → `/people/{self}`, `All circles` → `/family`. Person and group drill-ins arrive from Circles with a named header and a `‹ Circles` back link, and don't disturb the remembered primary mode. This is clean and should not be touched beyond the menu's typography.

### 2.6 Notes and reactions entry

- The note sheet (`CommentDrawer`) titles itself **"Add comment" / "Edit comment"**, while every other string in the Journal says *note* ("Notes from family", "Add a note to…", "Notes"). Its context line ("Brian · photo · We stayed until the light…") is set in mono, which reads as a citation rather than a helper. → P0 #3.
- Inline notes render **newest first** (`visibleConversationNotes` reverses). For a two-or-three-note family exchange this puts the reply above the thing it replies to ("I can still hear everyone laughing" above "The quiet ride home was my favorite part"). → P1 #7.
- The action row is `[note] [♡] names ⋯`. Heart-first is the more common convention, but note-first reads as a deliberate statement that conversation matters more than reaction. Leave it.

### 2.7 Date grammar across surfaces

Three spellings of the same month on one screen: `AUG 28, 2026` (marker, mono caps), `Aug. 28, 2026 · 8:14 PM` (rail meta, custom abbreviations with periods), `Aug 30 · 9:04 AM` (note stamps, Intl short month, no period). Nobody will misread it; a typographer will notice. → P1 #6.

### 2.8 Return-to-Journal

Inline media, native fullscreen video, scroll memory keyed per route, and `our-days:reveal-new-entry` cancelling restore after a post. Nothing to add. The one flow-adjacent thing worth a later brief is orientation on return after a day away (Feature F4).

---

## 3. Ranked polish tweaks

Each: **problem → proposal → why it helps → risk to muscle memory.** Frames exist for #1, #2, #3, #5.

### P0 — do these; low risk, visible gain

#### 1. One author per text card
*Frame:* `frames/01-one-author-per-text-card.png`

- **Problem.** On thought, place, and milestone cards the `PostAuthor` row (20px avatar + name) repeats the rail node (24px avatar + name) ~40px below it.
- **Proposal.** On `thought`, `location`, `milestone` cards, the card-top row keeps only context — place pin + short place, and `with …` participants — and is omitted entirely when neither exists. Photo and video cards keep the full author line (tall media justifies it). Insight cards already work this way.
- **Why it helps.** The rail becomes the single source of *who*; cards open directly on words. Thought cards get ~28px shorter; the feed gains rhythm without losing a single fact.
- **Risk.** Very low. Brian's family already reads *who* from the rail node color. The only new thing to learn is that a place name may lead a card without a name in front of it, and the pin glyph carries that.

#### 2. Journal switcher menu: interface type, opaque surface, locked helper copy
*Frame:* `frames/02-switcher-popover.png`

- **Problem.** Menu items are set in `--font-record` (mono), the surface is translucent (the `TODAY` pill shows through), and the locked subtitle *Everything you can see* isn't rendered anywhere in the build.
- **Proposal.** `--font-interface` at 15px/500 for items; opaque `--cream` surface with hairline and shadow (the same recipe as `.view-switch nav`); a two-line item with an 11px muted helper: *All circles — Everything you can see*. A helper under *Just me* is optional (mocked as "Only what you keep for yourself"; wording is Brian's call).
- **Why it helps.** The menu is a control, and controls speak sans everywhere else. The helper answers the one question the two-word labels leave open — what "all" means — in the place people ask it.
- **Risk.** None to muscle memory; same two items, same order, same position. Menu grows ~40px taller.

#### 3. Note sheet speaks the Journal's language
*Frame:* `frames/04-note-sheet-copy.png`

- **Problem.** Sheet title says "Add comment" / "Edit comment"; the rest of the Journal says *note*. The context line is mono.
- **Proposal.** "Add a note" / "Edit note". Context line in interface type at 13px, phrased: *On Brian's photo · "We stayed until the light disappeared…"*. Keep placeholder, keep Cancel/Post.
- **Why it helps.** One word for one thing. The sheet stops feeling like a component borrowed from a different product.
- **Risk.** None.

#### 4. Reactions render as glyphs, never emoji

- **Problem.** `reactionPresentation` maps `made-me-smile` → 😂 and `remember-this` → ✨ in the reaction-names row. Emoji rendering is platform-owned, saturated, and the only emoji on the surface.
- **Proposal.** Render the vocabulary's own symbols (`◡`, `✦`) as 14px inline glyphs in clay, matching `HeartGlyph` treatment; or a tiny SVG pair if `◡` renders inconsistently.
- **Why it helps.** Keeps the quiet reaction layer quiet. Also unblocks Feature F3 (exposing the vocabulary) without a palette break.
- **Risk.** None; these reactions are rare today.

### P1 — worth doing; try, keep only if it stays calm

#### 5. Day lives on the marker, time lives on the rail
*Frame:* `frames/03-day-on-marker-time-on-rail.png`

- **Problem.** Every card under a day marker repeats that day in its rail meta. Conversely, scrolled into a tall photo, *neither* the marker nor the meta is on screen — the in-card line gives who but not when.
- **Proposal.** Two changes that only work together: (a) rail meta shows time only (`9:42 pm`), nothing when there is no time; (b) the day marker becomes lightly `position: sticky` at the top of the feed, so the day is always visible. It already has paper fill and a hairline and will read as a bookmark, not a bar.
- **Why it helps.** Removes the most frequent repetition in the feed and *adds* context in the one case where the current design loses it.
- **Risk.** Medium. `.phone-stage` and `.app-shell` set `overflow: hidden`, which disables sticky — this is a container change, not a CSS one-liner, and it interacts with the scroll-away topbar. Sticky pills over full-bleed media can feel busy. Brian recently added the full date to the rail (`timelineCardOccurredLabel`), so this reverses a fresh decision; if the sticky half doesn't land, leave both halves alone. The current repetition is a low-cost sin.

#### 6. One date grammar

- **Problem.** `AUG 28, 2026` / `Aug. 28, 2026` / `Aug 30` on one screen (§2.7).
- **Proposal.** Pick Intl short month everywhere (`Aug 28, 2026 · 8:14 PM`; marker stays uppercase by CSS). Drop the custom `connectionMonths` table.
- **Why it helps.** Invisible consistency; the mono voice reads as one voice.
- **Risk.** None; "Sept." → "Sep" is the only visible change.

#### 7. Notes read as a conversation

- **Problem.** Inline notes are newest-first, so replies precede what they reply to.
- **Proposal.** Chronological (oldest first). Keep the two-note default; put the *Show N older* control **above** the visible notes so the newest stay adjacent to the action row.
- **Why it helps.** A two-person exchange reads top-to-bottom like a conversation. The newest note is still the one nearest your thumb.
- **Risk.** Low. Anyone used to glancing at the top note for "latest" will now glance at the bottom one; the action row is right there.

#### 8. Insight source label matches the medium

- **Problem.** `insightSourceLabel` returns *Listen* for YouTube as well as Spotify/Apple Podcasts.
- **Proposal.** *Watch* for `youtube.com` / `youtu.be`; *Listen* for podcast hosts; *Read the source* otherwise.
- **Why it helps.** The link says what will happen. Cheap.
- **Risk.** None.

### Later — small, optional

#### 9. Empty child journal: one quiet line
- On `/people/{child}` with no entries, add a single muted link under the empty-state copy — *Add June's first moment* — that opens the composer with June preselected. Text link, not a pill; not on the All-circles empty state. Calm, and it turns a dead end into the intended next step.

#### 10. Photo count on longer albums
- Dots are perfect up to 3–4 photos. At 5+, a tiny mono `1 / 6` in the frame corner scans better than seven dots. Only if albums that long actually happen.

---

## 4. Ranked feature ideas (product / tech — suggestions only)

Ranked by value to daily living in the Journal, divided by disturbance to what exists. None of these belong in the polish pass above.

### F1. Tap a day marker to jump through time
- **Job.** "Take me to summer 2023" without thumb-scrolling four years.
- **Placement.** The date pill becomes tappable (the marker row is already 42px tall; the hit area wraps the row). Opens a small sheet: years as a column, months as a row under the chosen year; tap → the feed re-anchors on that month's first marker. No search box, no calendar grid.
- **Why later.** Needs a pagination/anchor path that isn't cumulative `?pages=`, and a decision on whether it's a Journal feature or a Memories feature. Worth its own brief; it is the missing half of "travel through a life."

### F2. Rail node → that person's journal
- **Job.** Authorship clarity and quiet discovery: "show me more of Avery."
- **Placement.** The 24px author node on the rail becomes a link to `/people/{id}` (chips stay decoration-only — this is the node, not the chip). Visual stays identical; a 44px hit area wraps it.
- **Why later.** Trivial to build, but it introduces a tappable thing on the rail where nothing is tappable today, next to a chip that is locked as *not* tappable. Decide deliberately, with the Circles drill-in header already in place as the landing.

### F3. Expose the reaction vocabulary that already exists
- **Job.** Say "this made me smile" or "remember this" without writing a note.
- **Placement.** Long-press on the heart opens the existing `.inline-reaction-picker` (CSS is still in the sheet; data has three options with labels and symbols). Tap stays heart. Names row already renders mixed reactions.
- **Why later.** The vocabulary is a product decision (PD-deferred in the brief). Ship P0 #4 first so the glyphs are ready.

### F4. "Where you left off" mark on the rail
- **Job.** Open the app after a day away and see where new entries start, without a badge count or an unread list.
- **Placement.** A hairline pill on the rail — `New since Tuesday` — inserted once, above the first entry newer than the last-seen `occurred_at`, stored client-side alongside `TimelineScrollMemory` (no server state, no notification).
- **Why later.** It's one step toward engagement mechanics the product brief forbids. As a single rail marker it stays on the right side of that line; as anything more it doesn't. Needs Brian's call.

### F5. Duration on video posters
- **Job.** Know whether you're about to watch 6 seconds or 60 before tapping.
- **Placement.** Tiny mono `0:42` in the poster's lower corner, same treatment as `.photo-date`. Applies to video cards and Insight clips.
- **Why later.** Small and safe; bundle with the next media pass rather than shipping alone.

### F6. On-this-day whisper
- **Job.** The nostalgia return the brief calls success: "three years ago today, Avery's first day of school."
- **Placement.** A `tip`-variant Quiet card above today's marker, once per day, dismissible, linking to Memories. No streaks, no counts.
- **Why later.** Memories already owns On this day; duplicating it in the feed risks the "engagement prompt" smell the brief rules out. Only if Memories usage shows people aren't finding it.

---

## 5. Do not change

- **The rail grammar.** Day marker → author node → card. Node size, chip position, hairline connector, 30px between moments, 42px marker height. This is the product.
- **Full-bleed feed cards** with no border/radius; insets belong to chronology only.
- **The three-voice type system** and the serif for anything a person wrote.
- **Locked IA:** bottom nav Journal · Add · Circles; Settings top-left; header `Just me | All circles` only; composer posts to the recorder's own journal with Post-to owning circle audience.
- **Audience chips** as pure decoration, left of the rail. No tap, no expand, no edit.
- **Insight byline:** dark OD badge + text *Our Days* on the rail; card anatomy (label, serif quote, mono cite, link not embed, optional clip).
- **Quiet card banner** geometry and palette (Direction A). No gold/ochre.
- **Reactions as names, no totals.** Heart as the one-tap reaction.
- **Inline notes, note sheet as a bottom drawer, nav hidden while composing.**
- **Inline media, native video fullscreen, no lightbox.**
- **Empty and end states** as pill + one sentence. No illustration, no CTA pill (Later #9 is a text link, deliberately).
- **Topbar hierarchy** (wordmark over state). It's brand, and it becomes wallpaper.
- **Note-first action order.** Reads as intent; leave it.
- **Photo/video in-card author line.** Justified by media height; only text cards change (P0 #1).
- Settings, Circles, palette, Memories, Trash, auth — out of scope and not touched here.

---

## 6. Method and evidence

- Read: `timeline-feed.tsx`, `moment-card.tsx`, `post-author.tsx`, `audience-chip.tsx`, `moment-conversation-control.tsx`, `comment-drawer.tsx`, `moment-conversation-notes.ts`, `display-conversation-date.ts`, `timeline-view-model.ts`, `moments.server.ts` (`buildTimelineEntries`, date formatting), `journal-chrome.tsx`, `family-title-switcher.tsx`, `journal-switcher.ts`, `journal-heading.ts`, `primary-navigation.tsx`, `journal-banner.tsx`, `phone-notifications-announcement.tsx`, `insight-source.ts`, `video-moment-media.tsx`, and the timeline/topbar/nav/banner regions of `globals.css` (base rules ~L1244–1500, L2123–2500; dark overrides ~L5834–6400; latest connection/post rules ~L9513–9680).
- Docs: `docs/product/PRODUCT_BRIEF.md`, `docs/operations/OUR_DAYS_STATUS.md` (IA locks), `docs/quality/*` screenshots (dated; used only to see what changed).
- Rendered: design-preview build of `main` at 390×844 in dark and light; `/family`, `/people/brian`, `/people/june` (empty), switcher open, note sheet open, each card kind, end of feed.
- Frames in `frames/` are before/after composites for P0 #1, #2, #3 and P1 #5. "Proposed" panels are CSS/JS injected into the live preview — they show intent, not implementation.
- Reference images from the brief (`preview-brian-journal-banner`, `our-days-journal-tools-boxes`, `family-journal-codex`) were checked for feel; they predate the current chrome and were not used as a source of truth.

## Stop

Review written; frames attached. No implementation unless Brian locks and asks separately.
