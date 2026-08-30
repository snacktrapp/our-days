# Personal journals preview evidence

Date: 2026-08-30 (America/Los_Angeles)

Status: decision-independent, fixture-backed front-end contract. This slice establishes the personal-journal navigation, ownership semantics, chronological treatment, and empty state for all five initial family profiles. It does not authenticate a person, authorize access to a circle, query a database, or persist a moment.

## Product contract established

Every person on the People screen now has a distinct journal route. Brian and Molly are shown as co-organizers; Avery, Sam, and June remain clearly described as managed profiles with no sign-in. Opening a journal changes the title, accent, current switcher label, introductory identity, accessible timeline label, and moment set so the view belongs visibly and semantically to that person.

A moment has one stable `journalPersonId`. Personal journals filter on that identifier rather than a mutable display name, post recorder, or tagged person. This preserves the core rule that a family moment can mention several people while belonging to exactly one life journal. Avery's milestone therefore belongs to Avery's journal while retaining the truthful visible attribution **Added by Molly**.

Fixture history now reflects only the moments actually present:

- Brian: two moments, 2022–2026.
- Molly: three moments, 2019–2026.
- Avery: one milestone in 2023.
- Sam and June: no invented memories or counts; each says **No moments yet**.

Multi-moment journals preserve the center rail, meaningful elapsed-time gaps, year markers, and an earlier-years continuation. A one-moment journal ends honestly with **The story so far** rather than suggesting unseen older content. Empty journals keep the rail and use the warm invitation **A story ready to begin** instead of a blank feed or fabricated activity.

## Privacy boundary

- Every personal route is request-rendered inside the protected journal group and calls the fail-closed design-preview guard before constructing the fixture view model.
- Unknown person identifiers return a generic private soft-not-found response without family names or a member-directory hint. Next's streamed App Router response is deliberately accepted as HTTP 200: using the same document status as a valid journal avoids turning status into a member-existence signal, while `private`, `no-store`, and `noindex` prevent caching and indexing. The RSC body still carries Next's internal 404 fallback digest.
- Private links disable prefetching, preventing speculative personal-journal requests.
- Browser-generated RSC navigation envelopes for all five journals were replayed against a preview-disabled server; each returned only the private redirect payload and no family fixture canary.
- The production build's credential/private-fixture scan found no private fixture content in browser-deliverable artifacts.
- The personal-journal implementation adds no browser fetch, WebSocket, storage, cookie, cache, analytics, or third-party activity.

This is a presentation and routing proof, not a production authorization proof. Real journal reads must remain scoped by authenticated family-circle membership and database RLS, with managed-profile ownership and recorder identity modeled separately.

## Interaction and accessibility evidence

- People exposes five same-origin journal links in family order, each with an explicit accessible **View journal** label.
- Each route exposes an owner-specific timeline region such as **Chronological moments for Avery**.
- Active personal colors were darkened where necessary for small-text AA contrast while avatar colors remain warm and recognizable.
- The populated, sparse, and empty states retain one-dimensional reflow and 44 CSS-pixel action targets at 320×568.
- Axe reports no serious or critical findings on all five personal routes in Chromium and Firefox.
- Reduced-motion behavior remains intact, and deep content can scroll clear of the fixed bottom navigation.

## Verification snapshot

- `npm run check`: formatting, ESLint, TypeScript, and 182 unit/component/contract tests across 16 files passed.
- `npm run test:e2e`: its fresh webpack production build and private-artifact scan passed, followed by 138 browser checks passed, 50 intentional project-specific skips, and no failures.
- Local Playwright inventory: 188 checks across ten files. Prepared hosted CI inventory with WebKit: 247 checks across ten files.
- The personal-journals route suite passed 12/12 across Chromium mobile, Firefox mobile, and Chromium short.
- Exact route assertions cover all five current states, summaries, owner-specific moment IDs, ISO dates, elapsed gaps, and year dividers.
- Managed-profile assertions cover recorder truth and both empty journals.
- Unknown-person checks pin the accepted private soft-not-found status, headers, generic UI, internal RSC 404 digest, and absence of family canaries. Private RSC-envelope checks cover preview-enabled and preview-disabled navigation behavior.
- Four reviewed Chromium mobile baselines cover a multi-year populated journal, a sparse managed-profile milestone at its top and truthful ending, and an empty managed-profile journal.
- Independent UX/accessibility, privacy/adversarial, and test-gap reviewers returned **GO** after the recorder/default-journal identity, stale client-navigation state, sparse ending, chronology proof, soft-not-found contract, theme styling, and screenshot-artifact findings were fixed.

| Reviewed visual                                                        | SHA-256                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `personal-chromium-mobile-chromium-mobile-darwin.png`                  | `22d0ba0f8b906766b50aadf9d16cf5e6a7bfbab57abfa47421529c2ed3286acb` |
| `personal-avery-chromium-mobile-chromium-mobile-darwin.png`            | `94f55a46e95ff8ceb796219b2548989562d1ff39dbcdb2c1ba6771c571d40765` |
| `personal-avery-ending-chromium-mobile-chromium-mobile-darwin.png`     | `92bd5cc3edd6abb7cb9f992546189037f76b5df82a49b3a4b10ee16f8acdbdd2` |
| `personal-sam-empty-chromium-mobile-chromium-mobile-darwin.png`        | `6d07264aa45c79323d4119bd64e6453694c5192fe10baa62cbd311a3bf22c4ac` |

## Production gates deliberately deferred

- Authenticated account-to-profile binding and accepted PD-003 invitation/auth decisions.
- Circle membership and journal-read enforcement through Supabase RLS, including wrong-circle and revoked-member denial.
- Opaque production profile identifiers. Readable first-name path segments are loopback-preview fixtures only because URLs can persist in browser history and infrastructure logs.
- Production row-to-view-model mapping and stable cursor pagination.
- Accepted managed-profile author/edit/delete policy from PD-001 and PD-002.
- Real date/timezone semantics, scale testing, and On This Day queries.
- Physical iPhone Safari/standalone, VoiceOver, large-text, and hosted WebKit evidence.

No Supabase, GitHub, Vercel, email, analytics, or other external resource was created or connected by this checkpoint.
